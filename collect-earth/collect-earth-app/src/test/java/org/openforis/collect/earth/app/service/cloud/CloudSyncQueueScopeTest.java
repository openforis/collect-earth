package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import org.apache.commons.dbcp2.BasicDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.BatchResult;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.CloudApiException;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The queue of several cloud projects in one database: the sync of the project open takes, counts and marks its own
 * items only. Before, a record of another project was looked for in the open survey, not found there, and marked as
 * sent without ever being sent.
 */
public class CloudSyncQueueScopeTest {

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
	public void wire() throws Exception {
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
	}

	@AfterEach
	public void close() throws Exception {
		dataSource.close();
	}

	/** The project open: its survey, its cloud project, signed in */
	private void open(String surveyUri, String cloudProjectId) {
		CollectSurvey survey = mock(CollectSurvey.class);
		when(survey.getUri()).thenReturn(surveyUri);
		when(surveys.getCollectSurvey()).thenReturn(survey);
		when(properties.getCloudProjectId()).thenReturn(cloudProjectId);
		when(properties.getCloudSyncToken()).thenReturn("token");
	}

	@Test
	public void theOpenProjectsSyncLeavesTheRecordsOfAnotherProjectQueued() throws Exception {
		Date saved = new Date();
		queue.enqueue("1", "uri:kenya", "p-kenya", "ana", saved, false);
		queue.enqueue("2", "uri:kenya", "p-kenya", "ana", saved, false);
		queue.enqueue("7", "uri:peru", "p-peru", "bob", saved, false);
		// Peru open: Kenya's records are not in its survey, which is what made them "sent" before
		open("uri:peru", "p-peru");
		CollectRecord seven = mock(CollectRecord.class);
		when(surveys.loadRecord(new String[] { "7" })).thenReturn(seven);
		when(serializer.serialize(seven, "7", "uri:peru")).thenReturn(CloudRecordSerializer.tombstone("7", "uri:peru", "bob", saved));
		when(api.uploadRecordsBatch(anyList())).thenReturn(Collections.singletonList(new BatchResult("7", "stored", null)));

		sync.syncCycle();

		verify(surveys, never()).loadRecord(new String[] { "1" });
		assertEquals(1, queue.getStatus("uri:peru", "p-peru").getSynced());
		assertEquals(0, queue.getStatus("uri:peru", "p-peru").getPending());
		assertEquals(2, queue.getStatus("uri:kenya", "p-kenya").getPending());
		assertEquals(0, queue.getStatus("uri:kenya", "p-kenya").getSynced());
		assertEquals(2, queue.countUnsent("p-kenya"));
		assertEquals(0, queue.countUnsent("p-peru"));
		assertEquals(Boolean.TRUE, sync.isOnline());

		// Kenya opened again: now they go
		open("uri:kenya", "p-kenya");
		CollectRecord one = mock(CollectRecord.class);
		CollectRecord two = mock(CollectRecord.class);
		when(surveys.loadRecord(new String[] { "1" })).thenReturn(one);
		when(surveys.loadRecord(new String[] { "2" })).thenReturn(two);
		when(serializer.serialize(any(), any(), eq("uri:kenya"))).thenReturn(CloudRecordSerializer.tombstone("1", "uri:kenya", "ana", saved));
		when(api.uploadRecordsBatch(anyList())).thenReturn(java.util.Arrays.asList(new BatchResult("1", "stored", null), new BatchResult("2", "stale", null)));
		sync.syncCycle();
		assertEquals(2, queue.getStatus("uri:kenya", "p-kenya").getSynced());
		assertEquals(0, queue.countUnsent("p-kenya"));
	}

	@Test
	public void twoCloudProjectsOfOneSurveyHaveEachTheirItems() throws Exception {
		Date saved = new Date();
		queue.enqueue("1", "uri:shared", "p-a", "ana", saved, false);
		queue.enqueue("1", "uri:shared", "p-b", "ana", saved, false);
		open("uri:shared", "p-b");
		CollectRecord one = mock(CollectRecord.class);
		when(surveys.loadRecord(new String[] { "1" })).thenReturn(one);
		when(serializer.serialize(one, "1", "uri:shared")).thenReturn(CloudRecordSerializer.tombstone("1", "uri:shared", "ana", saved));
		when(api.uploadRecordsBatch(anyList())).thenReturn(Collections.singletonList(new BatchResult("1", "stored", null)));
		sync.syncCycle();
		assertEquals("SYNCED", queue.getRecordStatus("1", "uri:shared", "p-b"));
		assertEquals("PENDING", queue.getRecordStatus("1", "uri:shared", "p-a"));
	}

	@Test
	public void signedOutNothingIsSentAndTheRecordsWait() throws Exception {
		queue.enqueue("1", "uri:kenya", "p-kenya", "ana", new Date(), false);
		open("uri:kenya", "p-kenya");
		when(properties.getCloudSyncToken()).thenReturn("");
		sync.syncCycle();
		verify(api, never()).uploadRecordsBatch(anyList());
		assertEquals("pending", sync.recordState("1"));
		assertNull(sync.isOnline());
	}

	@Test
	public void aRecordDeletedHereIsTheOnlyOneMarkedSentWithoutTheServer() throws Exception {
		queue.enqueue("gone", "uri:kenya", "p-kenya", "ana", new Date(), false);
		open("uri:kenya", "p-kenya");
		sync.syncCycle();
		verify(api, never()).uploadRecordsBatch(anyList());
		assertEquals("SYNCED", queue.getRecordStatus("gone", "uri:kenya", "p-kenya"));
	}

	@Test
	public void unreachableIsOfflineAnAnswerIsOnline() throws Exception {
		queue.enqueue("1", "uri:kenya", "p-kenya", "ana", new Date(), false);
		open("uri:kenya", "p-kenya");
		CollectRecord one = mock(CollectRecord.class);
		when(surveys.loadRecord(new String[] { "1" })).thenReturn(one);
		when(serializer.serialize(one, "1", "uri:kenya")).thenReturn(CloudRecordSerializer.tombstone("1", "uri:kenya", "ana", new Date()));
		when(api.uploadRecordsBatch(anyList())).thenThrow(new IOException("Connection refused"));
		sync.syncCycle();
		assertEquals(Boolean.FALSE, sync.isOnline());
		assertEquals("failed", sync.recordState("1"));
		assertEquals(1, queue.countUnsent("p-kenya"));
		// Due again later (back-off): the next attempt is made once it is
		new JdbcTemplate(dataSource).update("UPDATE ce_cloud_sync_queue SET next_attempt_on = NULL");
		org.mockito.Mockito.doThrow(new CloudApiException("HTTP 503", 503, null)).when(api).uploadRecordsBatch(anyList());
		sync.syncCycle();
		assertEquals(Boolean.TRUE, sync.isOnline());
	}

	@Test
	public void theStateOfARecordIsTheOpenProjectsAndAChangeNotWrittenYetIsPending() throws Exception {
		open("uri:kenya", "p-kenya");
		assertEquals("local", sync.recordState("1"));
		queue.enqueue("1", "uri:kenya", "p-kenya", "ana", new Date(), false);
		assertEquals("pending", sync.recordState("1"));
		CollectRecord one = mock(CollectRecord.class);
		when(surveys.loadRecord(new String[] { "1" })).thenReturn(one);
		when(serializer.serialize(one, "1", "uri:kenya")).thenReturn(CloudRecordSerializer.tombstone("1", "uri:kenya", "ana", new Date()));
		when(api.uploadRecordsBatch(anyList())).thenReturn(Collections.singletonList(new BatchResult("1", "stored", null)));
		sync.syncCycle();
		assertEquals("sent", sync.recordState("1"));
		// Changed in the form, written to the database a moment later (the deferred save): never "sent" meanwhile
		when(surveys.hasUnsavedChanges("1")).thenReturn(true);
		assertEquals("pending", sync.recordState("1"));
		when(surveys.hasUnsavedChanges("1")).thenReturn(false);
		queue.enqueue("1", "uri:kenya", "p-kenya", "ana", new Date(), false);
		assertEquals("pending", sync.recordState("1"));
		// Another project's record is not this one's
		open("uri:kenya", "p-other");
		assertEquals("local", sync.recordState("1"));
	}

	/** A coordinator made the collector a reviewer: the next start says so, once the server answers */
	@Test
	public void theRoleAndTheNameAreAskedAgainOnceAStart() throws Exception {
		open("uri:kenya", "p-kenya");
		org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding kenya = new org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding(
				"C:/projects/kenya", "https://c.org", "p-kenya", null, "ana");
		kenya.role = "operator";
		when(properties.getCloudBinding()).thenReturn(kenya);
		when(api.getProject(any())).thenThrow(new IOException("Connection refused"));
		sync.syncCycle();
		verify(properties, never()).saveCloudBinding(any());
		org.mockito.Mockito.doReturn(new CloudApiClient.JoinPreview("p-kenya", "Kenya 2025", "reviewer", true)).when(api).getProject(any());
		when(api.isServerAdmin("https://c.org", "token")).thenReturn(null);
		sync.syncCycle();
		sync.syncCycle();
		verify(properties, org.mockito.Mockito.times(1)).saveCloudBinding(org.mockito.ArgumentMatchers.argThat(
				b -> "reviewer".equals(b.role) && "Kenya 2025".equals(b.projectName) && b.serverAdmin == null));
		verify(api, org.mockito.Mockito.times(2)).getProject(any());
	}

	@Test
	public void theQueueOfBeforeGivesItsItemsToTheCloudProjectOfBefore() throws Exception {
		JdbcTemplate jdbc = new JdbcTemplate(dataSource);
		jdbc.execute("CREATE TABLE ce_cloud_sync_queue (record_key VARCHAR(2048) NOT NULL, survey_uri VARCHAR(255) NOT NULL, "
				+ "operator VARCHAR(255), local_modified_on TIMESTAMP, sync_status VARCHAR(20) NOT NULL, attempts INTEGER DEFAULT 0 NOT NULL, "
				+ "next_attempt_on TIMESTAMP, last_error VARCHAR(2048), synced_on TIMESTAMP, deleted INTEGER DEFAULT 0 NOT NULL, "
				+ "PRIMARY KEY (record_key, survey_uri))");
		jdbc.update("INSERT INTO ce_cloud_sync_queue (record_key, survey_uri, sync_status, attempts, deleted) VALUES ('1', 'uri:kenya', 'PENDING', 0, 0)");
		jdbc.update("INSERT INTO ce_cloud_sync_queue (record_key, survey_uri, sync_status, attempts, deleted) VALUES ('2', 'uri:kenya', 'SYNCED', 0, 0)");
		when(properties.getValue(EarthProperty.CLOUD_PROJECT_ID)).thenReturn("p-before");
		assertEquals(1, queue.countUnsent("p-before"));
		assertEquals("SYNCED", queue.getRecordStatus("2", "uri:kenya", "p-before"));
		List<?> due = queue.takeDue(10, new Date(), "uri:kenya", "p-before");
		assertEquals(1, due.size());
		assertTrue(queue.takeDue(10, new Date(), "uri:kenya", "p-other").isEmpty());
		assertFalse(jdbc.queryForList("SELECT name FROM sqlite_master WHERE name = 'ce_cloud_sync_queue_new'").iterator().hasNext());
	}
}
