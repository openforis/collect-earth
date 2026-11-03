package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardService;
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
		actions.put("openDataFolder", () -> run.add("openDataFolder"));
		actions.put("openPlotsMap", () -> run.add("openPlotsMap"));
		actions.put("broken", () -> {
			throw new IllegalStateException("the folder cannot be opened");
		});
		actions.put("runUpdater", () -> {
			throw new ApiException("help.updaterMissing", "The updater (autoupdate.run) was not found next to Collect Earth");
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
	public void theDataFolderAndThePlotsMapAreOpened() throws Exception {
		mvc.perform(post("/api/actions/openDataFolder")).andExpect(status().isOk());
		mvc.perform(post("/api/actions/openPlotsMap")).andExpect(status().isOk());
		assertEquals(List.of("openDataFolder", "openPlotsMap"), run);
	}

	@Test
	public void anActionThatRefusesSaysWhy() throws Exception {
		mvc.perform(post("/api/actions/runUpdater")).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("help.updaterMissing"))
				.andExpect(jsonPath("$.message").value("The updater (autoupdate.run) was not found next to Collect Earth"));
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

	@Test
	public void myDashboardSaysWhyItCannotOpenYet() throws Exception {
		LocalDashboardService dashboard = mock(LocalDashboardService.class);
		when(dashboard.newSignInUrl()).thenReturn(null);
		when(dashboard.getStateText()).thenReturn("Getting ready\u2026");
		ApiException e = assertThrows(ApiException.class, () -> ActionsController.openDashboard(dashboard));
		assertEquals("dashboard.notReady", e.getCode());
		assertEquals("Getting ready\u2026", e.getMessage());
	}
}
