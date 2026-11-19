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

		assertEquals(0, sync.sendNow(10_000));
		assertEquals(0, queue.countToSend("uri:forest", "p1"));
		verify(api, times(3)).uploadRecordsBatch(anyList()); // batches of 50
	}

	@Test
	void offlineItSaysHowManyAreLeftAndStops() throws Exception {
		Date saved = new Date();
		queue.enqueue("1", "uri:forest", "p1", "ana", saved, false);
		queue.enqueue("2", "uri:forest", "p1", "ana", saved, false);
		when(api.uploadRecordsBatch(anyList())).thenThrow(new IOException("No route to host"));
		assertEquals(2, sync.sendNow(10_000));
		verify(api, times(1)).uploadRecordsBatch(anyList());
	}

	@Test
	void recordsInConflictAreNotWaitedFor() throws Exception {
		Date saved = new Date();
		queue.enqueue("1", "uri:forest", "p1", "ana", saved, false);
		queue.markConflict(queue.takeDue(1, new Date(), "uri:forest", "p1").get(0), "The server has a newer save");
		assertEquals(0, sync.sendNow(10_000));
		assertEquals(1, queue.countUnsent("p1"));
	}

	@Test
	void signedOutNothingIsSent() throws Exception {
		queue.enqueue("1", "uri:forest", "p1", "ana", new Date(), false);
		when(properties.getCloudSyncToken()).thenReturn("");
		assertEquals(1, sync.sendNow(10_000));
		verify(api, times(0)).uploadRecordsBatch(anyList());
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
