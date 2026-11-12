package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.cloud.CloudService;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

public class CloudControllerTest {

	private final CloudService cloud = mock(CloudService.class);
	private final AtomicBoolean restarted = new AtomicBoolean();
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new CloudController(cloud, () -> restarted.set(true)), new ApiExceptionHandler());
	}

	@Test
	public void thePreviewAnswersTheProjectOrTheReasonTheLinkIsNoGood() throws Exception {
		Map<String, Object> preview = new LinkedHashMap<>();
		preview.put("projectName", "Kenya 2025");
		when(cloud.preview("https://c.org/join/tok")).thenReturn(preview);
		mvc.perform(post("/api/cloud/preview").contentType(MediaType.APPLICATION_JSON).content("{\"url\":\"https://c.org/join/tok\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.projectName").value("Kenya 2025"));
		when(cloud.preview("x")).thenThrow(new InvalidCloudRequestException("cloud.invalidUrl", "Not a link"));
		mvc.perform(post("/api/cloud/preview").contentType(MediaType.APPLICATION_JSON).content("{\"url\":\"x\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("cloud.invalidUrl"))
				.andExpect(jsonPath("$.message").value("Not a link"));
	}

	@Test
	public void joiningRestartsOnceDone() throws Exception {
		mvc.perform(post("/api/cloud/join").contentType(MediaType.APPLICATION_JSON)
				.content("{\"baseUrl\":\"https://c.org\",\"inviteToken\":\"tok\",\"projectId\":\"p1\",\"username\":\"maria\",\"password\":\"pw\",\"register\":false}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.restart").value(true));
		assertTrue(restarted.get());
	}

	@Test
	public void aJoinThatFailsDoesNotRestart() throws Exception {
		doThrow(new InvalidCloudRequestException("cloud.login", "Invalid credentials")).when(cloud).join(any());
		mvc.perform(post("/api/cloud/join").contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"maria\",\"password\":\"bad\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("cloud.login"));
		assertFalse(restarted.get());
	}

	@Test
	public void theLoginAnswersTheOperator() throws Exception {
		when(cloud.login("maria", "pw")).thenReturn("maria");
		mvc.perform(post("/api/cloud/login").contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"maria\",\"password\":\"pw\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.operator").value("maria"));
	}

	@Test
	public void theLoginWithTheSecondStepsCodeOrRefused() throws Exception {
		when(cloud.login("maria", "pw", "123456")).thenReturn("maria");
		mvc.perform(post("/api/cloud/login").contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"maria\",\"password\":\"pw\",\"code\":\"123456\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.operator").value("maria"));
		when(cloud.login("maria", "wrong")).thenThrow(new InvalidCloudRequestException("cloud.login", "Invalid credentials"));
		mvc.perform(post("/api/cloud/login").contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"maria\",\"password\":\"wrong\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("cloud.login"));
	}

	@Test
	public void theSettingsLogInGivesTheTokenOfTheServerTyped() throws Exception {
		when(cloud.token("https://ce.example.org", "maria", "pw")).thenReturn("token-1");
		mvc.perform(post("/api/cloud/token").contentType(MediaType.APPLICATION_JSON)
				.content("{\"url\":\"https://ce.example.org\",\"username\":\"maria\",\"password\":\"pw\",\"code\":\" \"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.token").value("token-1"));
		when(cloud.token("https://ce.example.org", "maria", "pw", "123456")).thenReturn("token-2");
		mvc.perform(post("/api/cloud/token").contentType(MediaType.APPLICATION_JSON)
				.content("{\"url\":\"https://ce.example.org\",\"username\":\"maria\",\"password\":\"pw\",\"code\":\"123456\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.token").value("token-2"));
		when(cloud.token("https://ce.example.org", "maria", "wrong")).thenThrow(new InvalidCloudRequestException("cloud.login", "Invalid credentials"));
		mvc.perform(post("/api/cloud/token").contentType(MediaType.APPLICATION_JSON)
				.content("{\"url\":\"https://ce.example.org\",\"username\":\"maria\",\"password\":\"wrong\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("Invalid credentials"));
	}

	@Test
	public void aPlotsEarlierAnswersForTheFormsHeader() throws Exception {
		Map<String, Object> periods = new LinkedHashMap<>();
		periods.put("label", "2025");
		periods.put("periods", java.util.Collections.emptyList());
		when(cloud.plotPeriods("17,1")).thenReturn(periods);
		mvc.perform(get("/api/cloud/plot-periods").param("plot", "17,1")).andExpect(status().isOk()).andExpect(jsonPath("$.label").value("2025"));
	}

	@Test
	public void theStatusAndSyncNow() throws Exception {
		Map<String, Object> status = new LinkedHashMap<>();
		status.put("enabled", true);
		status.put("pending", 2);
		when(cloud.status()).thenReturn(status);
		mvc.perform(get("/api/cloud/status")).andExpect(status().isOk()).andExpect(jsonPath("$.pending").value(2));
		mvc.perform(post("/api/cloud/syncNow")).andExpect(status().isOk());
		verify(cloud).syncNow();
	}

	@Test
	public void theStateSigningOutAndTheSyncOfARecord() throws Exception {
		Map<String, Object> project = new LinkedHashMap<>();
		project.put("mode", "cloud");
		project.put("serverName", "c.org");
		Map<String, Object> state = new LinkedHashMap<>();
		state.put("project", project);
		state.put("sync", null);
		state.put("accounts", java.util.Collections.emptyList());
		when(cloud.state()).thenReturn(state);
		mvc.perform(get("/api/cloud/state")).andExpect(status().isOk()).andExpect(jsonPath("$.project.mode").value("cloud"))
				.andExpect(jsonPath("$.project.serverName").value("c.org")).andExpect(jsonPath("$.accounts").isArray());
		when(cloud.signOut("https://c.org")).thenReturn(state);
		mvc.perform(post("/api/cloud/signOut").contentType(MediaType.APPLICATION_JSON).content("{\"server\":\"https://c.org\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.project.mode").value("cloud"));
		verify(cloud).signOut("https://c.org");
		when(cloud.signOut(null)).thenThrow(new InvalidCloudRequestException("cloud.urlRequired", "Type the server"));
		mvc.perform(post("/api/cloud/signOut").contentType(MediaType.APPLICATION_JSON).content("{}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("cloud.urlRequired"));
		when(cloud.recordSync("101,2")).thenReturn(java.util.Collections.singletonMap("state", "pending"));
		mvc.perform(get("/api/cloud/recordSync").param("key", "101,2")).andExpect(status().isOk()).andExpect(jsonPath("$.state").value("pending"));
	}

	@Test
	public void aCloudProjectIsOpenedOnTheServerGivenOrTheFirstSignedInTo() throws Exception {
		mvc.perform(post("/api/cloud/projects/open").contentType(MediaType.APPLICATION_JSON).content("{\"projectId\":\"p2\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.restart").value(true));
		verify(cloud).open("p2", null);
		mvc.perform(post("/api/cloud/projects/open").contentType(MediaType.APPLICATION_JSON).content("{\"projectId\":\"p9\",\"server\":\"https://d.org\"}"))
				.andExpect(status().isOk());
		verify(cloud).open("p9", "https://d.org");
		assertTrue(restarted.get());
	}

	@Test
	public void theAssignmentsAreListedAndDownloaded() throws Exception {
		Map<String, Object> north = new LinkedHashMap<>();
		north.put("id", "a1");
		north.put("filename", "north.csv");
		when(cloud.assignments()).thenReturn(java.util.Collections.singletonList(north));
		mvc.perform(get("/api/cloud/assignments")).andExpect(status().isOk()).andExpect(jsonPath("$.assignments[0].filename").value("north.csv"));
		when(cloud.downloadAssignment("a1")).thenReturn(new java.io.File("/projects/p/assignments/north.csv"));
		mvc.perform(post("/api/cloud/assignments/download").contentType(MediaType.APPLICATION_JSON).content("{\"id\":\"a1\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.path").value(new java.io.File("/projects/p/assignments/north.csv").getAbsolutePath()));
		when(cloud.downloadAssignment("zz")).thenThrow(new InvalidCloudRequestException("cloud.noAssignment", "Could not download"));
		mvc.perform(post("/api/cloud/assignments/download").contentType(MediaType.APPLICATION_JSON).content("{\"id\":\"zz\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("cloud.noAssignment"));
	}
}
