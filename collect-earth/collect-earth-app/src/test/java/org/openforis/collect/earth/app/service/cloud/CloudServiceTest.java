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
}
