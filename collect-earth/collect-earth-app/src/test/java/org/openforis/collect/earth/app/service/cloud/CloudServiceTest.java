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
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.CloudApiException;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.JoinPreview;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.openforis.collect.earth.app.service.cloud.CloudService.JoinRequest;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueStatus;
import org.openforis.collect.earth.app.view.Messages;

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
		// Log in with the invitation: the account joins its project (a member of another project already)
		when(api.login("https://c.org", "maria", "pw", null, "tok")).thenReturn("session-token");
		when(api.downloadCep("https://c.org", "p1", "session-token")).thenReturn(cep);
		when(properties.getProjectFolder()).thenReturn("C:/projects/kenya");
		when(api.getProject(any())).thenReturn(new JoinPreview("p1", "Kenya 2025", "operator", true));
		when(api.isServerAdmin("https://c.org", "session-token")).thenReturn(false);
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.inviteToken = "tok";
		request.projectId = "p1";
		request.username = " maria ";
		request.password = "pw";
		service.join(request);
		verify(projects).loadCompressedProjectFile(cep);
		assertFalse(cep.exists());
		// the cloud mode is this project's only (EarthProjectsService.driverAfterLoading): its folder is bound
		verify(properties).saveCloudBinding(org.mockito.ArgumentMatchers.argThat(b -> "C:/projects/kenya".equals(b.folder)
				&& "https://c.org".equals(b.server) && "p1".equals(b.projectId) && "maria".equals(b.username) && "Kenya 2025".equals(b.projectName)
				&& "operator".equals(b.role) && Boolean.FALSE.equals(b.serverAdmin)));
		verify(properties).saveCloudToken("https://c.org", "maria", "session-token");
		verify(properties).saveOperator("maria");
		verify(properties).setCloudSyncEnabled(true);
		verify(properties).saveCollectDBDriver(CollectDBDriver.CLOUD);
		// the next start offers to send the records this computer has (CloudRecordsSender)
		verify(properties).setValue(org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty.CLOUD_OFFER_LOCAL_RECORDS, "true");
	}

	/** The projects of every server signed in to, each with its server, the open one marked, those here marked */
	@Test
	public void listsTheProjectsOfEveryServerSignedInToTheOpenOneMarked() throws Exception {
		java.util.Map<String, String> accounts = new java.util.LinkedHashMap<>();
		accounts.put("https://c.org", "maria");
		accounts.put("https://d.org", "maria.k");
		accounts.put("https://down.org", "maria");
		when(properties.getCloudAccounts()).thenReturn(accounts);
		when(properties.getCloudToken("https://c.org")).thenReturn("session-token");
		when(properties.getCloudToken("https://d.org")).thenReturn("token-d");
		when(properties.getCloudToken("https://down.org")).thenReturn("token-down");
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudSyncUrl()).thenReturn("https://c.org/");
		when(properties.getCloudProjectId()).thenReturn("p2");
		when(properties.getCloudBindings()).thenReturn(java.util.Arrays.asList(new CloudBinding("C:/projects/peru", "https://c.org", "p2", "Peru", "maria"),
				new CloudBinding("C:/projects/chad", "https://d.org", "p9", "Chad", "maria.k")));
		when(api.listProjects("https://c.org", "session-token")).thenReturn(java.util.Arrays.asList(
				new JoinPreview("p1", "Kenya 2025", "operator", true), new JoinPreview("p2", "Peru", "admin", true)));
		when(api.listProjects("https://d.org", "token-d")).thenReturn(java.util.Arrays.asList(new JoinPreview("p9", "Chad", "reviewer", true)));
		when(api.listProjects("https://down.org", "token-down")).thenThrow(new IOException("Connection refused"));
		java.util.List<Map<String, Object>> mine = service.myProjects();
		assertEquals(3, mine.size());
		assertEquals("Kenya 2025", mine.get(0).get("projectName"));
		assertEquals("operator", mine.get(0).get("role"));
		assertEquals(false, mine.get(0).get("active"));
		assertEquals(false, mine.get(0).get("onThisComputer"));
		assertEquals("https://c.org", mine.get(0).get("server"));
		assertEquals("c.org", mine.get(0).get("serverName"));
		assertEquals(true, mine.get(1).get("active"));
		assertEquals(true, mine.get(1).get("onThisComputer"));
		assertEquals("d.org", mine.get(2).get("serverName"));
		assertEquals(false, mine.get(2).get("active"));
		assertEquals(true, mine.get(2).get("onThisComputer"));
		// No server answering at all is said
		when(properties.getCloudAccounts()).thenReturn(java.util.Collections.singletonMap("https://down.org", "maria"));
		assertEquals("cloud.projects", assertThrows(InvalidCloudRequestException.class, service::myProjects).getCode());
	}

	@Test
	public void nobodySignedInHasNoCloudProjects() throws Exception {
		assertEquals(0, service.myProjects().size());
		verify(api, never()).listProjects(any(), any());
	}

	@Test
	public void opensAProjectWithTheSignInKeptAndBindsItsFolder() throws Exception {
		File cep = new File(folder, "peru.cep");
		java.nio.file.Files.write(cep.toPath(), new byte[] { 1 });
		java.util.Map<String, String> accounts = new java.util.LinkedHashMap<>();
		accounts.put("https://c.org", "maria");
		accounts.put("https://d.org", "maria.k");
		when(properties.getCloudAccounts()).thenReturn(accounts);
		when(properties.getCloudToken("https://c.org")).thenReturn("session-token");
		when(properties.getCloudToken("https://d.org")).thenReturn("token-d");
		when(properties.getProjectFolder()).thenReturn("C:/projects/peru");
		when(api.downloadCep("https://c.org", "p2", "session-token")).thenReturn(cep);
		when(api.getProject(any())).thenReturn(new JoinPreview("p2", "Peru", "admin", true));
		// No server given (the request of before): the first signed in to
		service.open("p2", null);
		verify(projects).loadCompressedProjectFile(cep);
		verify(properties).saveCloudBinding(org.mockito.ArgumentMatchers.argThat(b -> "C:/projects/peru".equals(b.folder) && "https://c.org".equals(b.server)
				&& "p2".equals(b.projectId) && "Peru".equals(b.projectName) && "admin".equals(b.role) && "maria".equals(b.username)));
		verify(properties).saveCloudToken("https://c.org", "maria", "session-token");
		verify(properties).saveOperator("maria");
		verify(properties).saveCollectDBDriver(CollectDBDriver.CLOUD);
		// Another server's, with its own sign-in
		java.nio.file.Files.write(cep.toPath(), new byte[] { 1 });
		when(api.downloadCep("https://d.org", "p9", "token-d")).thenReturn(cep);
		service.open("p9", "https://d.org/");
		verify(properties).saveCloudToken("https://d.org", "maria.k", "token-d");
		// only an id goes into the download's address, and only a server signed in to
		assertEquals("cloud.projects", assertThrows(InvalidCloudRequestException.class, () -> service.open("../admin", null)).getCode());
		assertEquals("cloud.projects", assertThrows(InvalidCloudRequestException.class, () -> service.open("p3", "https://unknown.org")).getCode());
	}

	@Test
	public void registeringUsesTheInvitation() throws Exception {
		when(api.register("https://c.org", "maria", "password12", "tok")).thenReturn("t");
		when(api.downloadCep("https://c.org", "p1", "t")).thenReturn(new File(folder, "none.cep"));
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.inviteToken = "tok";
		request.projectId = "p1";
		request.username = "maria";
		request.password = "password12";
		request.register = true;
		service.join(request);
		verify(api, never()).login(any(), any(), any());
		verify(properties).saveCloudToken("https://c.org", "maria", "t");
	}

	@Test
	public void aShortPasswordIsSaidPlainlyWhenRegistering() throws Exception {
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.inviteToken = "tok";
		request.projectId = "p1";
		request.username = "maria";
		request.password = "1234567";
		request.register = true;
		// Refused here, before the server is asked, in the user's language
		InvalidCloudRequestException e = assertThrows(InvalidCloudRequestException.class, () -> service.join(request));
		assertEquals("cloud.weakPassword", e.getCode());
		assertEquals(Messages.getString("CloudLoginDialog.passwordTooShort"), e.getMessage());
		verify(api, never()).register(any(), any(), any(), any());
		// A login is not a new account: a short password there is the server's to judge
		request.register = false;
		when(api.login("https://c.org", "maria", "1234567", null, "tok")).thenThrow(new IOException("Invalid credentials"));
		assertEquals("cloud.login", assertThrows(InvalidCloudRequestException.class, () -> service.join(request)).getCode());
		// A server with a stricter rule: its weak_password said in the same plain words, not as HTTP 400 and JSON
		request.register = true;
		request.password = "eight-chars-but-refused";
		when(api.register("https://c.org", "maria", "eight-chars-but-refused", "tok")).thenThrow(new CloudApiException(
				"register failed with HTTP 400: {\"error\":\"weak_password\"}", 400, "weak_password"));
		e = assertThrows(InvalidCloudRequestException.class, () -> service.join(request));
		assertEquals("cloud.weakPassword", e.getCode());
		assertEquals(Messages.getString("CloudLoginDialog.passwordTooShort"), e.getMessage());
		verify(properties, never()).setCloudSyncEnabled(true);
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
		// The token of the open project's server, its account the user
		verify(properties).saveCloudToken("https://c.org", "maria", "t2");
		verify(properties).saveOperator("maria");
	}

	/** The Log in button of the settings: the server typed there, which is not saved yet; the token goes into its field */
	@Test
	public void theLoginOfTheSettingsAnswersTheTokenAndSavesNothing() throws Exception {
		when(api.login("https://typed.org", "maria", "pw")).thenReturn("t3");
		assertEquals("t3", service.token(" https://typed.org ", " maria ", "pw"));
		verify(properties, never()).saveCloudSyncToken(any());
		verify(properties, never()).saveCloudToken(any(), any(), any());
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
	public void aPlotsEarlierAnswersComeFromTheCloudOnceThenFromMemory() throws Exception {
		com.fasterxml.jackson.databind.ObjectMapper json = new com.fasterxml.jackson.databind.ObjectMapper();
		// Not a cloud project: no periods, the cloud not asked
		when(properties.isCloudSyncEnabled()).thenReturn(false);
		assertEquals(java.util.Collections.emptyList(), service.plotPeriods("17,1").get("periods"));
		verify(api, never()).getPlotPeriods(any());

		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudProjectId()).thenReturn("p1");
		when(api.getPlotPeriods("17,1")).thenReturn(json.readTree(
				"{\"periods\":[{\"label\":\"2020\",\"answers\":{\"collect_code_land_use\":\"F\"}}],\"label\":\"2025\",\"header\":[\"collect_code_land_use\"]}"));
		Map<String, Object> answer = service.plotPeriods("17,1");
		assertEquals("2025", answer.get("label"));
		assertEquals(1, ((java.util.List<?>) answer.get("periods")).size());
		// a second time from memory
		assertEquals(answer, service.plotPeriods("17,1"));
		verify(api, org.mockito.Mockito.times(1)).getPlotPeriods("17,1");
		// another project's plot of the same id is asked again
		when(properties.getCloudProjectId()).thenReturn("p2");
		service.plotPeriods("17,1");
		verify(api, org.mockito.Mockito.times(2)).getPlotPeriods("17,1");

		// The server cannot be reached: no periods, never an error in the form
		when(api.getPlotPeriods("18,1")).thenThrow(new IOException("offline"));
		assertEquals(java.util.Collections.emptyList(), service.plotPeriods("18,1").get("periods"));
		assertEquals(java.util.Collections.emptyList(), service.plotPeriods(" ").get("periods"));
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

	/** Two-step sign-in: the server asks for the code, the page sends it with the password, a wrong one is said as such */
	@Test
	public void twoStepSignInAsksForTheCodeThenSendsIt() throws Exception {
		when(properties.getCloudSyncUrl()).thenReturn("https://c.org");
		when(api.login("https://c.org", "cora", "pw")).thenThrow(new CloudApiClient.SecondStepException("required"));
		assertEquals("cloud.secondStepRequired", assertThrows(InvalidCloudRequestException.class, () -> service.login("cora", "pw")).getCode());
		when(api.login("https://c.org", "cora", "pw", "000000")).thenThrow(new CloudApiClient.SecondStepException("invalid"));
		assertEquals("cloud.secondStepInvalid", assertThrows(InvalidCloudRequestException.class, () -> service.login("cora", "pw", "000000")).getCode());
		when(api.login("https://c.org", "cora", "pw", "123456")).thenReturn("t4");
		assertEquals("cora", service.login("cora", "pw", "123456"));
		verify(properties).saveCloudToken("https://c.org", "cora", "t4");
		// The join and the settings' Log in button take it too
		when(api.login("https://typed.org", "cora", "pw", "K7QD-2MXP-9TVA")).thenReturn("t5");
		assertEquals("t5", service.token("https://typed.org", "cora", "pw", "K7QD-2MXP-9TVA"));
		when(api.login("https://c.org", "cora", "pw", "654321")).thenThrow(new CloudApiClient.SecondStepException("unreadable"));
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.username = "cora";
		request.password = "pw";
		request.code = "654321";
		assertEquals("cloud.secondStepUnreadable", assertThrows(InvalidCloudRequestException.class, () -> service.join(request)).getCode());
	}

	@Test
	public void theServersAnswersAboutTheSecondStepAreRecognised() {
		assertEquals("required", CloudApiClient.secondStepKind(401, "{\"error\":\"second_step_required\"}"));
		assertEquals("invalid", CloudApiClient.secondStepKind(401, "{\"error\":\"invalid_second_step\"}"));
		assertEquals("unreadable", CloudApiClient.secondStepKind(401, "{\"error\":\"second_step_unreadable\"}"));
		assertNull(CloudApiClient.secondStepKind(401, "{\"error\":\"invalid_credentials\"}"));
		assertNull(CloudApiClient.secondStepKind(403, "{\"error\":\"second_step_required\"}"));
	}

	/** Joining unzips over the folder of the survey: another cloud project's there, with records not sent, is not replaced */
	@Test
	public void joiningOverAnotherCloudProjectWithRecordsNotSentIsRefused() throws Exception {
		File cep = new File(folder, "kenya.cep");
		java.nio.file.Files.write(cep.toPath(), new byte[] { 1 });
		File kenya = new File(folder, "kenya");
		when(api.login("https://c.org", "maria", "pw", null, "tok")).thenReturn("session-token");
		when(api.downloadCep("https://c.org", "p2", "session-token")).thenReturn(cep);
		when(projects.projectFolderFor(cep)).thenReturn(kenya);
		when(properties.getCloudBinding(kenya)).thenReturn(new CloudBinding(kenya.getPath(), "https://c.org", "p1", "Kenya 2025", "maria"));
		when(sync.unsentCount("p1")).thenReturn(3);
		JoinRequest request = new JoinRequest();
		request.baseUrl = "https://c.org";
		request.inviteToken = "tok";
		request.projectId = "p2";
		request.username = "maria";
		request.password = "pw";
		InvalidCloudRequestException e = assertThrows(InvalidCloudRequestException.class, () -> service.join(request));
		assertEquals("cloud.unsentRecords", e.getCode());
		assertEquals(java.text.MessageFormat.format(Messages.getString("CloudJoin.unsentRecords"), 3, "Kenya 2025"), e.getMessage());
		verify(projects, never()).loadCompressedProjectFile(any());
		verify(properties, never()).saveCloudBinding(any());
		verify(properties, never()).saveCloudToken(any(), any(), any());
		assertFalse(cep.exists());
		// All sent: the folder is the new project's
		when(sync.unsentCount("p1")).thenReturn(0);
		java.nio.file.Files.write(cep.toPath(), new byte[] { 1 });
		service.join(request);
		verify(projects).loadCompressedProjectFile(cep);
		// The same cloud project joined again (a new link) never is refused
		when(sync.unsentCount("p1")).thenReturn(5);
		request.projectId = "p1";
		when(api.downloadCep("https://c.org", "p1", "session-token")).thenReturn(cep);
		java.nio.file.Files.write(cep.toPath(), new byte[] { 1 });
		service.join(request);
	}

	@Test
	public void theStateOfACloudProjectItsSyncAndTheAccounts() {
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		CloudBinding kenya = new CloudBinding("C:/projects/kenya", "https://c.org", "p1", "Kenya 2025", "maria");
		kenya.role = "reviewer";
		kenya.serverAdmin = true;
		when(properties.getCloudBinding()).thenReturn(kenya);
		when(properties.getCloudSyncUrl()).thenReturn("https://c.org/");
		when(properties.getCloudProjectId()).thenReturn("p1");
		when(properties.getCloudSyncToken()).thenReturn("t");
		when(properties.getValue(org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty.SURVEY_NAME)).thenReturn("kenya_2025");
		java.util.Map<String, String> accounts = new java.util.LinkedHashMap<>();
		accounts.put("https://c.org", "maria");
		accounts.put("https://other.org:8443", "m.k");
		when(properties.getCloudAccounts()).thenReturn(accounts);
		when(sync.getStatusSnapshot()).thenReturn(new QueueStatus(2, 1, 40, new Date(1700000000000L), "HTTP 503"));
		when(sync.isOnline()).thenReturn(false);
		Map<String, Object> state = service.state();
		@SuppressWarnings("unchecked")
		Map<String, Object> project = (Map<String, Object>) state.get("project");
		assertEquals("cloud", project.get("mode"));
		assertEquals("kenya_2025", project.get("name"));
		assertEquals("https://c.org", project.get("server"));
		assertEquals("c.org", project.get("serverName"));
		assertEquals("p1", project.get("cloudProjectId"));
		assertEquals("Kenya 2025", project.get("cloudProjectName"));
		assertEquals("maria", project.get("account"));
		assertEquals(true, project.get("signedIn"));
		assertEquals("reviewer", project.get("role"));
		assertEquals(true, project.get("serverAdmin"));
		@SuppressWarnings("unchecked")
		Map<String, Object> sync = (Map<String, Object>) state.get("sync");
		assertEquals(2, sync.get("pending"));
		assertEquals(1, sync.get("failed"));
		assertEquals("2023-11-14T22:13:20Z", sync.get("lastSyncedOn"));
		assertEquals("HTTP 503", sync.get("lastError"));
		assertEquals(false, sync.get("online"));
		assertEquals(false, sync.get("needsSignIn"));
		@SuppressWarnings("unchecked")
		java.util.List<Map<String, Object>> list = (java.util.List<Map<String, Object>>) state.get("accounts");
		assertEquals(2, list.size());
		assertEquals("other.org", list.get(1).get("serverName"));
		assertEquals("m.k", list.get(1).get("username"));
	}

	@Test
	public void theStateOfALocalProjectHasNoSync() {
		when(properties.getValue(org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty.SURVEY_NAME)).thenReturn("peru");
		when(properties.getCloudAccounts()).thenReturn(java.util.Collections.singletonMap("https://c.org", "maria"));
		Map<String, Object> state = service.state();
		@SuppressWarnings("unchecked")
		Map<String, Object> project = (Map<String, Object>) state.get("project");
		assertEquals("local", project.get("mode"));
		assertEquals("peru", project.get("name"));
		assertNull(project.get("server"));
		assertNull(project.get("account"));
		assertEquals(false, project.get("signedIn"));
		assertNull(project.get("role"));
		assertNull(project.get("serverAdmin"));
		assertNull(state.get("sync"));
		assertEquals(1, ((java.util.List<?>) state.get("accounts")).size());
		assertEquals("local", service.recordSync("1").get("state"));
		verify(sync, never()).recordState(any());
	}

	@Test
	public void signingOutForgetsTheServersTokenAndAnswersTheState() throws Exception {
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getCloudSyncUrl()).thenReturn("https://c.org");
		when(properties.getCloudSyncToken()).thenReturn("");
		when(sync.getStatusSnapshot()).thenReturn(new QueueStatus(4, 0, 0, null, null));
		Map<String, Object> state = service.signOut("https://c.org");
		verify(properties).saveCloudToken("https://c.org", null, "");
		@SuppressWarnings("unchecked")
		Map<String, Object> syncState = (Map<String, Object>) state.get("sync");
		assertEquals(true, syncState.get("needsSignIn"));
		assertEquals(4, syncState.get("pending"));
		assertEquals("cloud.urlRequired", assertThrows(InvalidCloudRequestException.class, () -> service.signOut(" ")).getCode());
	}

	@Test
	public void theSyncOfARecordIsTheQueuesInACloudProject() {
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(sync.recordState("1,2")).thenReturn("sent");
		assertEquals("sent", service.recordSync(" 1,2 ").get("state"));
	}
}
