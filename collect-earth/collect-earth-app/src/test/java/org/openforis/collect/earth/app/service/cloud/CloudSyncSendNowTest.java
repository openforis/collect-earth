package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Properties;

import org.apache.commons.dbcp2.BasicDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.BatchResult;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.JoinPreview;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueItem;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;

/**
 * The records not sent yet, sent at once before a changed survey is taken (SurveyUpdateService), and the binding the
 * sync refreshes left as it is stored.
 */
class CloudSyncSendNowTest {

	@TempDir
	File folder;

	private BasicDataSource dataSource;
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final EarthSurveyService surveys = mock(EarthSurveyService.class);
	private final CloudApiClient api = mock(CloudApiClient.class);
	private final CloudRecordSerializer serializer = mock(CloudRecordSerializer.class);
	private final CloudSyncQueueDao queue = new CloudSyncQueueDao();
	private final CloudSyncService sync = new CloudSyncService();

	private static void inject(Object target, String name, Object value) throws Exception {
		Field field = target.getClass().getDeclaredField(name);
		field.setAccessible(true);
		field.set(target, value);
	}

	@BeforeEach
	void wire() throws Exception {
		dataSource = new BasicDataSource();
		dataSource.setDriverClassName("org.sqlite.JDBC");
		dataSource.setUrl("jdbc:sqlite:" + new File(folder, "collect.db").getAbsolutePath());
		dataSource.setMaxTotal(1);
		inject(queue, "dataSource", dataSource);
		inject(queue, "properties", properties);
		inject(sync, "earthSurveyService", surveys);
		inject(sync, "localPropertiesService", properties);
		inject(sync, "queueDao", queue);
		inject(sync, "serializer", serializer);
		inject(sync, "apiClient", api);
		CollectSurvey survey = mock(CollectSurvey.class);
		when(survey.getUri()).thenReturn("uri:forest");
		when(surveys.getCollectSurvey()).thenReturn(survey);
		when(properties.getCloudProjectId()).thenReturn("p1");
		when(properties.getCloudSyncToken()).thenReturn("token");
		when(surveys.loadRecord(any(String[].class))).thenReturn(mock(CollectRecord.class));
		when(serializer.serialize(any(), anyString(), anyString()))
				.thenAnswer(i -> CloudRecordSerializer.tombstone(i.getArgument(1), "uri:forest", "ana", new Date()));
	}

	@AfterEach
	void close() throws Exception {
		dataSource.close();
	}

	/** What the server answers: every record stored */
	private void serverStoresAll() throws IOException {
		when(api.uploadRecordsBatch(anyList())).thenAnswer(i -> {
			List<BatchResult> results = new ArrayList<>();
			for (Object envelope : i.<List<?>> getArgument(0)) {
				results.add(new BatchResult(((CloudRecordSerializer.RecordEnvelope) envelope).getRecordKey(), "stored", null));
			}
			return results;
		});
	}

	@Test
	void sendsEveryRecordNotSentWhateverItsBackoff() throws Exception {
		Date saved = new Date();
		for (int i = 0; i < 120; i++) {
			queue.enqueue("plot" + i, "uri:forest", "p1", "ana", saved, false);
		}
		// One failed before, to be retried in an hour
		QueueItem failed = queue.takeDue(1, new Date(), "uri:forest", "p1").get(0);
		queue.markFailed(failed, "offline", new Date(System.currentTimeMillis() + 3_600_000L));
		assertTrue(queue.takeDue(200, new Date(), "uri:forest", "p1").size() < 120);
		serverStoresAll();

		assertEquals(0, sync.sendNow(10_000).getToSend());
		assertEquals(0, queue.countToSend("uri:forest", "p1"));
		verify(api, times(3)).uploadRecordsBatch(anyList()); // batches of 50
	}

	@Test
	void offlineItSaysHowManyAreLeftAndStops() throws Exception {
		Date saved = new Date();
		queue.enqueue("1", "uri:forest", "p1", "ana", saved, false);
		queue.enqueue("2", "uri:forest", "p1", "ana", saved, false);
		when(api.uploadRecordsBatch(anyList())).thenThrow(new IOException("No route to host"));
		CloudSyncService.Unsent unsent = sync.sendNow(10_000);
		assertEquals(2, unsent.getToSend());
		assertEquals(0, unsent.getRefused());
		verify(api, times(1)).uploadRecordsBatch(anyList());
	}

	@Test
	void recordsInConflictAreNotWaitedFor() throws Exception {
		Date saved = new Date();
		queue.enqueue("1", "uri:forest", "p1", "ana", saved, false);
		queue.markConflict(queue.takeDue(1, new Date(), "uri:forest", "p1").get(0), "The server has a newer save");
		assertEquals(0, sync.sendNow(10_000).getToSend());
		assertEquals(1, queue.countUnsent("p1"));
	}

	@Test
	void signedOutNothingIsSent() throws Exception {
		queue.enqueue("1", "uri:forest", "p1", "ana", new Date(), false);
		when(properties.getCloudSyncToken()).thenReturn("");
		assertEquals(1, sync.sendNow(10_000).getToSend());
		verify(api, times(0)).uploadRecordsBatch(anyList());
	}

	/**
	 * Review: a record the server refuses with an error (or that cannot be prepared here) is sent again in vain: it does not
	 * hold back the others, nor a changed survey, and is said apart. Those not reached the server still count.
	 */
	@Test
	void recordsTheServerRefusesDoNotHoldTheOthersBack() throws Exception {
		Date saved = new Date(System.currentTimeMillis() - 60_000);
		// 60 refused, older than the rest: more than a batch, taken first each time
		for (int i = 0; i < 60; i++) {
			queue.enqueue("bad" + i, "uri:forest", "p1", "ana", saved, false);
		}
		Date later = new Date();
		for (int i = 0; i < 30; i++) {
			queue.enqueue("good" + i, "uri:forest", "p1", "ana", later, false);
		}
		// one that cannot be read here
		queue.enqueue("unreadable", "uri:forest", "p1", "ana", later, false);
		when(surveys.loadRecord(new String[] { "unreadable" })).thenThrow(new IllegalStateException("cannot be read"));
		when(api.uploadRecordsBatch(anyList())).thenAnswer(i -> {
			List<BatchResult> results = new ArrayList<>();
			for (Object envelope : i.<List<?>> getArgument(0)) {
				String key = ((CloudRecordSerializer.RecordEnvelope) envelope).getRecordKey();
				results.add(new BatchResult(key, key.startsWith("bad") ? "error" : "stored", key.startsWith("bad") ? "invalid record" : null));
			}
			return results;
		});

		CloudSyncService.Unsent unsent = sync.sendNow(10_000);

		assertEquals(0, unsent.getToSend(), "the refused ones do not hold anything back");
		assertEquals(61, unsent.getRefused());
		for (int i = 0; i < 30; i++) {
			assertEquals(CloudSyncQueueDao.STATUS_SYNCED, queue.getRecordStatus("good" + i, "uri:forest", "p1"));
		}
		assertEquals(61, queue.countToSend("uri:forest", "p1"), "still retried later by the sync");
	}

	/** A record the server said nothing about, or offline: they could be sent later, so they are waited for */
	@Test
	void recordsTheServerSaidNothingAboutAreWaitedFor() throws Exception {
		Date saved = new Date();
		queue.enqueue("1", "uri:forest", "p1", "ana", saved, false);
		queue.enqueue("2", "uri:forest", "p1", "ana", saved, false);
		when(api.uploadRecordsBatch(anyList())).thenReturn(java.util.Collections.singletonList(new BatchResult("1", "error", "invalid")));
		CloudSyncService.Unsent unsent = sync.sendNow(10_000);
		assertEquals(1, unsent.getToSend());
		assertEquals(1, unsent.getRefused());
	}

	/**
	 * Review: another project opened applies its settings at once (its cloud project read from its folder's binding),
	 * the survey of before still loaded until the restart. The saves written at the shutdown are queued for the project
	 * they were made in, and the final flush sends them there, not to the project opened.
	 */
	@Test
	@SuppressWarnings("unchecked")
	void theLastSavesGoToTheProjectTheyWereMadeInWhenAnotherIsOpened() throws Exception {
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudSyncUrl()).thenReturn("https://a.org/");
		when(properties.getCloudToken("https://a.org")).thenReturn("token-a");
		org.mockito.ArgumentCaptor<org.openforis.collect.earth.app.service.AbstractEarthSurveyService.RecordSavedListener> listener = org.mockito.ArgumentCaptor
				.forClass(org.openforis.collect.earth.app.service.AbstractEarthSurveyService.RecordSavedListener.class);
		sync.onApplicationEvent(null);
		try {
			verify(surveys).addRecordSavedListener(listener.capture());
			// Another project opened: its settings applied
			when(properties.getCloudProjectId()).thenReturn("p2");
			when(properties.getCloudSyncUrl()).thenReturn("https://b.org");
			when(properties.getCloudSyncToken()).thenReturn("token-b");
			assertTrue(sync.projectChanged());
			// The form's last change, written at the shutdown
			CollectRecord record = mock(CollectRecord.class);
			when(record.getModifiedDate()).thenReturn(new Date());
			listener.getValue().recordSaved("7", record);
			assertEquals(1, queue.countToSend("uri:forest", "p1"));
			assertEquals(0, queue.countToSend("uri:forest", "p2"));
			when(api.uploadRecordsBatch(any(CloudApiClient.Destination.class), anyList()))
					.thenReturn(java.util.Collections.singletonList(new BatchResult("7", "stored", null)));

			sync.syncCycle();

			org.mockito.ArgumentCaptor<CloudApiClient.Destination> to = org.mockito.ArgumentCaptor.forClass(CloudApiClient.Destination.class);
			verify(api).uploadRecordsBatch(to.capture(), anyList());
			assertEquals("https://a.org", to.getValue().getBaseUrl());
			assertEquals("p1", to.getValue().getProjectId());
			assertEquals("token-a", to.getValue().getToken());
			verify(api, times(0)).uploadRecordsBatch(anyList());
			// nothing of the other project's is done with this one's survey
			verify(api, times(0)).uploadSurveyDefinition(any(), any());
			assertEquals(CloudSyncQueueDao.STATUS_SYNCED, queue.getRecordStatus("7", "uri:forest", "p1"));
		} finally {
			sync.shutdownAndFlush(1000);
		}
	}

	/** The project's name and role asked of the server do not undo a revision saved while it answered */
	@Test
	void refreshingTheProjectKeepsWhatWasSavedMeanwhile() throws Exception {
		LocalPropertiesService real = new LocalPropertiesService(new Properties());
		File project = new File(folder, "forest");
		real.setValue(EarthProperty.METADATA_FILE, new File(project, "placemark.idm.xml").getAbsolutePath());
		real.saveCloudBinding(new CloudBinding(project.getAbsolutePath(), "https://a.org", "p1", null, "ana"));
		real.saveCloudToken("https://a.org", "ana", "token");
		inject(sync, "localPropertiesService", real);
		when(api.getProject(any())).thenAnswer(i -> {
			// SurveyUpdateService meanwhile
			real.updateCloudBinding(project, b -> b.surveyRevision = "r1");
			return new JoinPreview("p1", "Forest", "operator", true);
		});
		when(api.isServerAdmin(any(), any())).thenReturn(Boolean.FALSE);

		sync.refreshProject();

		CloudBinding stored = real.getCloudBinding();
		assertEquals("r1", stored.surveyRevision);
		assertEquals("Forest", stored.projectName);
		assertEquals("operator", stored.role);
		assertEquals(Boolean.FALSE, stored.serverAdmin);
	}
}
