package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.io.IOException;
import java.util.Date;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.JoinPreview;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.openforis.collect.earth.app.service.cloud.CloudService.JoinRequest;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueStatus;

public class CloudServiceTest {

	@TempDir
	File folder;
	private final CloudApiClient api = mock(CloudApiClient.class);
	private final CloudSyncService sync = mock(CloudSyncService.class);
	private final EarthProjectsService projects = mock(EarthProjectsService.class);
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final CloudService service = new CloudService(api, sync, projects, properties);

	@Test
	public void theInvitationLinkGivesTheServerAndTheToken() throws Exception {
		assertArrayEquals(new String[] { "https://cloud.example.org", "abc123" }, CloudService.parseInvitation(" https://cloud.example.org/join/abc123 "));
		assertArrayEquals(new String[] { "https://cloud.example.org/ce", "abc123" }, CloudService.parseInvitation("https://cloud.example.org/ce/join/abc123/?utm=x"));
		assertEquals("cloud.invalidUrl", assertThrows(InvalidCloudRequestException.class, () -> CloudService.parseInvitation("https://cloud.example.org/abc")).getCode());
		assertEquals("cloud.invalidUrl", assertThrows(InvalidCloudRequestException.class, () -> CloudService.parseInvitation("https://cloud.example.org/join/")).getCode());
	}

	@Test
	public void thePreviewSaysWhatTheInvitationIsFor() throws Exception {
		when(api.getJoinPreview("https://c.org", "tok")).thenReturn(new JoinPreview("p1", "Kenya 2025", "interpreter", true));
		Map<String, Object> preview = service.preview("https://c.org/join/tok");
		assertEquals("Kenya 2025", preview.get("projectName"));
		assertEquals("interpreter", preview.get("role"));
		assertEquals("p1", preview.get("projectId"));
		assertEquals("tok", preview.get("inviteToken"));
		when(api.getJoinPreview("https://c.org", "old")).thenReturn(new JoinPreview(null, null, null, false));
		assertEquals("cloud.inviteInvalid", assertThrows(InvalidCloudRequestException.class, () -> service.preview("https://c.org/join/old")).getCode());
	}

	@Test
	public void joiningLogsInDownloadsLoadsAndSwitchesToCloudMode() throws Exception {
		File cep = new File(folder, "kenya.cep");
		java.nio.file.Files.write(cep.toPath(), new byte[] { 1 });
		when(api.login("https://c.org", "maria", "pw")).thenReturn("session-token");
		when(api.downloadCep("https://c.org", "p1", "session-token")).thenReturn(cep);
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.inviteToken = "tok";
		request.projectId = "p1";
		request.username = " maria ";
		request.password = "pw";
		service.join(request);
		verify(projects).loadCompressedProjectFile(cep);
		assertFalse(cep.exists());
		verify(properties).saveCloudSyncUrl("https://c.org");
		verify(properties).saveCloudProjectId("p1");
		verify(properties).saveCloudSyncToken("session-token");
		verify(properties).saveOperator("maria");
		verify(properties).setCloudSyncEnabled(true);
		verify(properties).saveCollectDBDriver(CollectDBDriver.CLOUD);
	}

	@Test
	public void registeringUsesTheInvitation() throws Exception {
		when(api.register("https://c.org", "maria", "pw", "tok")).thenReturn("t");
		when(api.downloadCep("https://c.org", "p1", "t")).thenReturn(new File(folder, "none.cep"));
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.inviteToken = "tok";
		request.projectId = "p1";
		request.username = "maria";
		request.password = "pw";
		request.register = true;
		service.join(request);
		verify(api, never()).login(any(), any(), any());
		verify(properties).saveCloudSyncToken("t");
	}

	@Test
	public void aRefusedLoginLeavesEverythingAsItWas() throws Exception {
		when(api.login("https://c.org", "maria", "bad")).thenThrow(new IOException("Invalid credentials"));
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.username = "maria";
		request.password = "bad";
		InvalidCloudRequestException e = assertThrows(InvalidCloudRequestException.class, () -> service.join(request));
		assertEquals("cloud.login", e.getCode());
		assertEquals("Invalid credentials", e.getMessage());
		verify(properties, never()).setCloudSyncEnabled(true);
		// The fields must be filled, and the server must answer a token
		request.password = "";
		assertEquals("cloud.emptyFields", assertThrows(InvalidCloudRequestException.class, () -> service.join(request)).getCode());
		request.password = "pw";
		when(api.login("https://c.org", "maria", "pw")).thenReturn(" ");
		assertEquals("cloud.noToken", assertThrows(InvalidCloudRequestException.class, () -> service.join(request)).getCode());
	}

	@Test
	public void theLoginAtStartSavesTheTokenAndTheOperator() throws Exception {
		when(properties.getCloudSyncUrl()).thenReturn("https://c.org");
		when(api.login("https://c.org", "maria", "pw")).thenReturn("t2");
		assertEquals("maria", service.login(" maria ", "pw"));
		verify(properties).saveCloudSyncToken("t2");
		verify(properties).saveOperator("maria");
	}

	/** The Log in button of the settings: the server typed there, which is not saved yet; the token goes into its field */
	@Test
	public void theLoginOfTheSettingsAnswersTheTokenAndSavesNothing() throws Exception {
		when(api.login("https://typed.org", "maria", "pw")).thenReturn("t3");
		assertEquals("t3", service.token(" https://typed.org ", " maria ", "pw"));
		verify(properties, never()).saveCloudSyncToken(any());
		verify(properties, never()).saveOperator(any());
		assertEquals("cloud.urlRequired", assertThrows(InvalidCloudRequestException.class, () -> service.token(" ", "maria", "pw")).getCode());
		assertEquals("cloud.emptyFields", assertThrows(InvalidCloudRequestException.class, () -> service.token("https://typed.org", "maria", "")).getCode());
	}

	@Test
	public void theStatusIsTheQueuesWhenCloudSyncIsOn() {
		when(properties.isCloudSyncEnabled()).thenReturn(false);
		Map<String, Object> off = service.status();
		assertEquals(false, off.get("enabled"));
		assertFalse(off.containsKey("pending"));
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudProjectId()).thenReturn("p1");
		Date when = new Date(1700000000000L);
		when(sync.getStatusSnapshot()).thenReturn(new QueueStatus(3, 1, 40, when, " "));
		Map<String, Object> on = service.status();
		assertEquals("p1", on.get("project"));
		assertEquals(3, on.get("pending"));
		assertEquals(1, on.get("failed"));
		assertEquals(40, on.get("synced"));
		assertEquals(1700000000000L, on.get("lastSync"));
		assertNull(on.get("lastError"));
		service.syncNow();
		verify(sync).syncNowAsync();
	}

	@Test
	public void theAssignmentsAreListedWithTheOneInUseMarked() throws Exception {
		when(properties.getValue(org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty.SAMPLE_FILE))
				.thenReturn(new File(folder, "assignments/north.csv").getPath());
		when(api.getMyAssignments()).thenReturn(java.util.Arrays.asList(
				new CloudApiClient.AssignmentInfo("a1", "north.csv", "c1", "/d/a1", 120),
				new CloudApiClient.AssignmentInfo("a2", "south.csv", "c2", "/d/a2", 80)));
		java.util.List<Map<String, Object>> list = service.assignments();
		assertEquals(2, list.size());
		assertEquals("a1", list.get(0).get("id"));
		assertEquals(120, list.get(0).get("plots"));
		assertEquals(true, list.get(0).get("active"));
		assertEquals(false, list.get(1).get("active"));
	}

	@Test
	public void anAssignmentIsDownloadedIntoTheProjectsAssignmentsFolder() throws Exception {
		when(properties.getImdFile()).thenReturn(new File(folder, "project/survey.idm.xml").getPath());
		CloudApiClient.AssignmentInfo south = new CloudApiClient.AssignmentInfo("a2", "south.csv", "c2", "/d/a2", 80);
		when(api.getMyAssignments()).thenReturn(java.util.Collections.singletonList(south));
		File expected = new File(new File(folder, "project/assignments"), "south.csv");
		when(api.downloadAssignedCsv(south, new File(folder, "project/assignments").getAbsoluteFile())).thenReturn(expected);
		assertEquals(expected, service.downloadAssignment("a2"));
		assertEquals("cloud.noAssignment", assertThrows(InvalidCloudRequestException.class, () -> service.downloadAssignment("zz")).getCode());
	}

	@Test
	public void aLearningSetInANewAttemptDeletesTheEarlierRecordsOfItsPlots() throws Exception {
		org.openforis.collect.earth.app.service.EarthSurveyService survey = mock(org.openforis.collect.earth.app.service.EarthSurveyService.class);
		service.setSurveyService(survey);
		when(survey.getKeyAttributeCount()).thenReturn(2);
		when(properties.getImdFile()).thenReturn(new File(folder, "project/survey.idm.xml").getPath());
		Date since = new Date(1700000000000L);
		CloudApiClient.AssignmentInfo learning = new CloudApiClient.AssignmentInfo("s1", "Learning – nov.csv", "c", "/d/s1", 2, since);
		CloudApiClient.AssignmentInfo plain = new CloudApiClient.AssignmentInfo("a1", "north.csv", "c1", "/d/a1", 1);
		when(api.getMyAssignments()).thenReturn(java.util.Arrays.asList(learning, plain));
		File csv = new File(folder, "learning.csv");
		java.nio.file.Files.write(csv.toPath(), "id;round;lat;lon\r\n\"9001\";1;-19;34\r\n9002;1;-19;34\r\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
		File assignments = new File(folder, "project/assignments").getAbsoluteFile();
		when(api.downloadAssignedCsv(learning, assignments)).thenReturn(csv);
		when(api.downloadAssignedCsv(plain, assignments)).thenReturn(csv);
		service.downloadAssignment("s1");
		@SuppressWarnings("unchecked")
		org.mockito.ArgumentCaptor<java.util.List<String[]>> keys = org.mockito.ArgumentCaptor.forClass(java.util.List.class);
		verify(survey).deleteRecordsSavedBefore(keys.capture(), org.mockito.ArgumentMatchers.eq(since));
		assertEquals(3, keys.getValue().size());
		assertArrayEquals(new String[] { "9001", "1" }, keys.getValue().get(1));
		assertArrayEquals(new String[] { "9002", "1" }, keys.getValue().get(2));
		// Any other file: nothing deleted.
		org.mockito.Mockito.clearInvocations(survey);
		service.downloadAssignment("a1");
		verify(survey, never()).deleteRecordsSavedBefore(any(), any());
	}

	@Test
	public void aFailureToStartAfreshNeverFailsTheDownload() throws Exception {
		org.openforis.collect.earth.app.service.EarthSurveyService survey = mock(org.openforis.collect.earth.app.service.EarthSurveyService.class);
		service.setSurveyService(survey);
		when(survey.getKeyAttributeCount()).thenReturn(1);
		when(survey.deleteRecordsSavedBefore(any(), any())).thenThrow(new IllegalStateException("database locked"));
		when(properties.getImdFile()).thenReturn(new File(folder, "project/survey.idm.xml").getPath());
		CloudApiClient.AssignmentInfo learning = new CloudApiClient.AssignmentInfo("s1", "Learning – nov.csv", "c", "/d/s1", 1, new Date(1L));
		when(api.getMyAssignments()).thenReturn(java.util.Collections.singletonList(learning));
		File csv = new File(folder, "l.csv");
		java.nio.file.Files.write(csv.toPath(), "id,lat\n1,2\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
		when(api.downloadAssignedCsv(any(), any())).thenReturn(csv);
		assertEquals(csv, service.downloadAssignment("s1"));
	}

	@Test
	public void theTrainingFeedbackSyncsFirstAndAsksAgainWhileThePlotIsOnItsWay() throws Exception {
		com.fasterxml.jackson.databind.ObjectMapper json = new com.fasterxml.jackson.databind.ObjectMapper();
		when(properties.isCloudSyncEnabled()).thenReturn(false);
		assertEquals("none", service.trainingFeedback("9001").get("status"));
		verify(sync, never()).syncNowAsync();

		when(properties.isCloudSyncEnabled()).thenReturn(true);
		service.waitMs = 1;
		when(api.getTrainingFeedback("9001")).thenReturn(json.readTree("{\"status\":\"pending\"}"),
				json.readTree("{\"status\":\"scored\",\"plot\":{\"plot\":\"9001\",\"right\":true}}"));
		Map<String, Object> answer = service.trainingFeedback("9001");
		assertEquals("scored", answer.get("status"));
		verify(sync).syncNowAsync();
		verify(api, org.mockito.Mockito.times(2)).getTrainingFeedback("9001");

		// The server cannot be reached: nothing to show, never an error in the form.
		when(api.getTrainingFeedback("9002")).thenThrow(new IOException("offline"));
		assertEquals("none", service.trainingFeedback("9002").get("status"));
	}

	@Test
	public void thePlotKeysAreTheFirstColumnsWhateverTheSeparator() throws Exception {
		File csv = new File(folder, "p.csv");
		java.nio.file.Files.write(csv.toPath(), "\uFEFFid,lat,lon\n12,1,2\n\n13,3,4\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
		java.util.List<String[]> keys = CloudService.plotKeys(csv, 1);
		assertEquals(3, keys.size());
		assertArrayEquals(new String[] { "id" }, keys.get(0));
		assertArrayEquals(new String[] { "13" }, keys.get(2));
		java.nio.file.Files.write(csv.toPath(), "id\tlat\n7\t1\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
		assertArrayEquals(new String[] { "7" }, CloudService.plotKeys(csv, 1).get(1));
	}

	@Test
	public void aServerThatCannotListTheAssignmentsSaysSo() throws Exception {
		when(api.getMyAssignments()).thenThrow(new IOException("HTTP 401"));
		InvalidCloudRequestException e = assertThrows(InvalidCloudRequestException.class, service::assignments);
		assertEquals("cloud.assignments", e.getCode());
	}
}
