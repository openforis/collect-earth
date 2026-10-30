package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

/** The quick actions of the menus, answered as the server's own wiring does (see TemplateWiring). */
public class ActionsControllerTest {

	private final List<String> run = new ArrayList<>();
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		Map<String, Runnable> actions = new LinkedHashMap<>();
		actions.put("quit", () -> run.add("quit"));
		actions.put("openBackupFolder", () -> run.add("openBackupFolder"));
		actions.put("broken", () -> {
			throw new IllegalStateException("the folder cannot be opened");
		});
		mvc = TemplateWiring.mockMvc(new ActionsController(actions), new ApiExceptionHandler());
	}

	@Test
	public void quitQuits() throws Exception {
		mvc.perform(post("/api/actions/quit")).andExpect(status().isOk());
		assertEquals(List.of("quit"), run);
	}

	@Test
	public void theBackupFolderIsOpened() throws Exception {
		mvc.perform(post("/api/actions/openBackupFolder")).andExpect(status().isOk());
		assertEquals(List.of("openBackupFolder"), run);
	}

	@Test
	public void anUnknownActionIsNotFound() throws Exception {
		mvc.perform(post("/api/actions/fly")).andExpect(status().isNotFound());
		assertTrue(run.isEmpty());
	}

	@Test
	public void anActionThatFailsIsAFault() throws Exception {
		mvc.perform(post("/api/actions/broken")).andExpect(status().isInternalServerError())
				.andExpect(jsonPath("$.error").value("internal"))
				.andExpect(jsonPath("$.details").value("the folder cannot be opened"));
	}
}
