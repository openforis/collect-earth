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
	public void theStatusAndSyncNow() throws Exception {
		Map<String, Object> status = new LinkedHashMap<>();
		status.put("enabled", true);
		status.put("pending", 2);
		when(cloud.status()).thenReturn(status);
		mvc.perform(get("/api/cloud/status")).andExpect(status().isOk()).andExpect(jsonPath("$.pending").value(2));
		mvc.perform(post("/api/cloud/syncNow")).andExpect(status().isOk());
		verify(cloud).syncNow();
	}
}
