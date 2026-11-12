package org.openforis.collect.earth.app.server.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient;
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
	public void theDataFolderIsOpened() throws Exception {
		mvc.perform(post("/api/actions/openDataFolder")).andExpect(status().isOk());
		assertEquals(List.of("openDataFolder"), run);
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

	@Test
	public void aDeveloperCanHaveTheLinkLoggedInsteadOfOpened() throws Exception {
		LocalDashboardService dashboard = mock(LocalDashboardService.class);
		when(dashboard.newSignInUrl()).thenReturn("http://127.0.0.1:1/local-sign-in/abc");
		System.setProperty(ActionsController.LOG_SIGN_IN_URL_PROPERTY, "true");
		try {
			// no browser is opened, so nothing fails in a container without one
			ActionsController.openDashboard(dashboard);
		} finally {
			System.clearProperty(ActionsController.LOG_SIGN_IN_URL_PROPERTY);
		}
	}

	@Test
	public void theAnalysisPageIsTheLocalDashboardsOrTheClouds() {
		assertEquals("http://127.0.0.1:5000/local-sign-in/abc?to=analysis", ActionsController.analysisUrl(false, null, null, "http://127.0.0.1:5000/local-sign-in/abc"));
		assertEquals("https://ce.example.org/projects/p%201/analysis", ActionsController.analysisUrl(true, "https://ce.example.org//", " p 1 ", "ignored"));
		// not ready: the page is told why
		assertEquals(null, ActionsController.analysisUrl(false, null, null, null));
		assertEquals(null, ActionsController.analysisUrl(true, "https://ce.example.org", "", null));
		assertEquals(null, ActionsController.analysisUrl(true, " ", "p1", null));
	}

	@Test
	public void aCloudProjectsDashboardIsItsPageOnTheCloud() {
		assertEquals("https://ce.example.org/projects/p%201", ActionsController.cloudPageUrl("https://ce.example.org/", " p 1 ", ""));
		assertEquals("https://ce.example.org/projects/p1/analysis", ActionsController.cloudPageUrl("https://ce.example.org", "p1", "analysis"));
		assertEquals(null, ActionsController.cloudPageUrl("https://ce.example.org", " ", ""));
	}

	// Tools > My dashboard and Analyse the data, without a browser: what is told when they cannot open

	private static LocalPropertiesService project(boolean cloud) {
		LocalPropertiesService properties = mock(LocalPropertiesService.class);
		when(properties.isCloudSyncEnabled()).thenReturn(cloud);
		return properties;
	}

	private static CloudApiClient cloudAt(String baseUrl, String projectId) {
		CloudApiClient cloud = mock(CloudApiClient.class);
		when(cloud.cloudDestination()).thenReturn(new CloudApiClient.Destination(baseUrl, projectId, "token"));
		return cloud;
	}

	@Test
	public void aCloudProjectWithoutItsProjectHasNoAnalysisNorDashboardToOpen() {
		LocalDashboardService dashboard = mock(LocalDashboardService.class);
		CloudApiClient cloud = cloudAt("https://ce.example.org", " ");
		ApiException analysis = assertThrows(ApiException.class, () -> ActionsController.openAnalysis(dashboard, project(true), cloud));
		assertEquals("analysis.noCloudProject", analysis.getCode());
		ApiException mine = assertThrows(ApiException.class, () -> ActionsController.openDashboard(dashboard, project(true), cloud));
		assertEquals("analysis.noCloudProject", mine.getCode());
		// the local dashboard is not asked for a cloud project
		verify(dashboard, never()).getStateText();
	}

	@Test
	public void theLocalAnalysisSaysWhyItCannotOpenYet() throws Exception {
		LocalDashboardService dashboard = mock(LocalDashboardService.class);
		when(dashboard.newSignInUrl()).thenReturn(null);
		when(dashboard.getStateText()).thenReturn("Getting ready\u2026");
		ApiException e = assertThrows(ApiException.class, () -> ActionsController.openAnalysis(dashboard, project(false), mock(CloudApiClient.class)));
		assertEquals("dashboard.notReady", e.getCode());
		assertEquals("Getting ready\u2026", e.getMessage());
		// and My dashboard, local, the same
		assertEquals("dashboard.notReady", assertThrows(ApiException.class, () -> ActionsController.openDashboard(dashboard, project(false), mock(CloudApiClient.class))).getCode());
	}

	@Test
	public void aDashboardThatCannotGiveALinkIsAFault() throws Exception {
		LocalDashboardService dashboard = mock(LocalDashboardService.class);
		when(dashboard.newSignInUrl()).thenThrow(new IOException("connection refused"));
		IllegalStateException analysis = assertThrows(IllegalStateException.class, () -> ActionsController.openAnalysis(dashboard, project(false), mock(CloudApiClient.class)));
		assertTrue(analysis.getMessage().contains("connection refused"));
		IllegalStateException mine = assertThrows(IllegalStateException.class, () -> ActionsController.openDashboard(dashboard));
		assertTrue(mine.getMessage().contains("connection refused"));
	}

	@Test
	public void aDeveloperCanHaveTheAnalysisLinkLoggedInsteadOfOpened() throws Exception {
		LocalDashboardService dashboard = mock(LocalDashboardService.class);
		when(dashboard.newSignInUrl()).thenReturn("http://127.0.0.1:1/local-sign-in/abc");
		System.setProperty(ActionsController.LOG_SIGN_IN_URL_PROPERTY, "true");
		try {
			ActionsController.openAnalysis(dashboard, project(false), mock(CloudApiClient.class));
			ActionsController.openDashboard(dashboard, project(false), mock(CloudApiClient.class));
		} finally {
			System.clearProperty(ActionsController.LOG_SIGN_IN_URL_PROPERTY);
		}
	}

	@Test
	public void theServersWiringHasEveryAction() throws Exception {
		LocalDashboardService dashboard = mock(LocalDashboardService.class);
		when(dashboard.newSignInUrl()).thenReturn(null);
		when(dashboard.getStateText()).thenReturn("Not installed");
		ActionsController controller = new ActionsController(null, null, null, null, dashboard, project(false), mock(CloudApiClient.class));
		MockMvc wired = TemplateWiring.mockMvc(controller, new ApiExceptionHandler());
		// the two of the dashboard, through the server's own wiring: told why they cannot open
		wired.perform(post("/api/actions/openDashboard")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("dashboard.notReady"));
		wired.perform(post("/api/actions/openAnalysis")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("Not installed"));
	}
}
