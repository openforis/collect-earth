package org.openforis.collect.earth.app.server.api;

import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.model.CollectSurvey;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** What the app bar shows and the operator it changes, answered as the server's own wiring does (see TemplateWiring). */
public class AppInfoControllerTest {

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final AtomicInteger versionReads = new AtomicInteger();
	private final AppInfoController controller = new AppInfoController(properties, () -> "Sierra Leone 2026", () -> {
		versionReads.incrementAndGet();
		return "1.23.20";
	});
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(controller, new ApiExceptionHandler());
	}

	@Test
	public void saysWhatTheAppBarShows() throws Exception {
		when(properties.getOperator()).thenReturn("alfonso");
		when(properties.getUiLanguage()).thenReturn(UI_LANGUAGE.ES);
		when(properties.getValue(EarthProperty.VIEWER_TYPE)).thenReturn("google_earth_web");
		when(properties.isPlotsMapViewer()).thenReturn(true);
		mvc.perform(get("/api/app")).andExpect(status().isOk())
				.andExpect(jsonPath("$.project").value("Sierra Leone 2026"))
				.andExpect(jsonPath("$.operator").value("alfonso"))
				.andExpect(jsonPath("$.language").value("es"))
				.andExpect(jsonPath("$.viewer").value("google_earth_web"))
				.andExpect(jsonPath("$.plotsMap").value(true))
				.andExpect(jsonPath("$.version").value("1.23.20"));
	}

	@Test
	public void theInstalledVersionIsReadOnce() throws Exception {
		// reading update.ini logs an error when it is not there, as when running from the IDE, and errors go to Sentry
		when(properties.getUiLanguage()).thenReturn(UI_LANGUAGE.EN);
		mvc.perform(get("/api/app")).andExpect(status().isOk());
		mvc.perform(get("/api/app")).andExpect(status().isOk());
		assertEquals(1, versionReads.get());
	}

	@Test
	public void theOperatorIsSaved() throws Exception {
		mvc.perform(put("/api/app/operator").contentType(MediaType.APPLICATION_JSON).content("{\"operator\":\"  maria.k  \"}"))
				.andExpect(status().isOk());
		verify(properties).saveOperator("maria.k");
	}

	@Test
	public void anOperatorNameOfFiveCharactersOrLessIsRefused() throws Exception {
		// CollectEarthWindow.33: longer than 5 characters and shorter than 50
		mvc.perform(put("/api/app/operator").contentType(MediaType.APPLICATION_JSON).content("{\"operator\":\"anaka\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("operator.length"));
		verify(properties, never()).saveOperator(anyString());
	}

	@Test
	public void anOperatorNameOfFiftyCharactersOrMoreIsRefused() throws Exception {
		String fifty = "abcdefghij" + "abcdefghij" + "abcdefghij" + "abcdefghij" + "abcdefghij";
		mvc.perform(put("/api/app/operator").contentType(MediaType.APPLICATION_JSON).content("{\"operator\":\"" + fifty + "\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("operator.length"));
		verify(properties, never()).saveOperator(anyString());
	}

	@Test
	public void noOperatorIsRefused() throws Exception {
		mvc.perform(put("/api/app/operator").contentType(MediaType.APPLICATION_JSON).content("{}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("operator.length"));
		verify(properties, never()).saveOperator(anyString());
	}

	@Test
	public void theOperatorOfTheCloudLoginCannotBeChanged() throws Exception {
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		mvc.perform(put("/api/app/operator").contentType(MediaType.APPLICATION_JSON).content("{\"operator\":\"maria.k\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("operator.cloud"))
				.andExpect(jsonPath("$.message").value(Messages.getString("AppInfoController.operatorCloud")))
				// Messages answers !key! for a key no bundle has
				.andExpect(jsonPath("$.message").value(not(startsWith("!"))));
		verify(properties, never()).saveOperator(anyString());
	}

	@Test
	public void theProjectNameIsTheOneOfTheUiLanguage() {
		CollectSurvey survey = mock(CollectSurvey.class);
		when(survey.getProjectName("es")).thenReturn("Sierra Leona 2026");
		when(survey.getProjectName()).thenReturn("Sierra Leone 2026");
		assertEquals("Sierra Leona 2026", AppInfoController.projectName(survey, "es"));
	}

	@Test
	public void withNoNameInTheUiLanguageTheProjectNameIsTheOneOfTheDefaultLanguage() {
		CollectSurvey survey = mock(CollectSurvey.class);
		when(survey.getProjectName("es")).thenReturn(" ");
		when(survey.getProjectName()).thenReturn("Sierra Leone 2026");
		assertEquals("Sierra Leone 2026", AppInfoController.projectName(survey, "es"));
	}

	@Test
	public void withNoNameTheProjectNameIsTheDescription() {
		CollectSurvey survey = mock(CollectSurvey.class);
		when(survey.getDescription("es")).thenReturn("Inventario de Sierra Leona");
		assertEquals("Inventario de Sierra Leona", AppInfoController.projectName(survey, "es"));
	}

	@Test
	public void withNoSurveyThereIsNoProjectName() {
		assertNull(AppInfoController.projectName(null, "es"));
	}
}
