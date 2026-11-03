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

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
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
	@TempDir
	File folder;
	private File guide;
	private AppInfoController controller;
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		when(properties.getUiLanguage()).thenReturn(UI_LANGUAGE.EN);
		when(properties.getOperationMode()).thenReturn(OperationMode.SERVER_MODE);
		controller = new AppInfoController(properties, () -> "Sierra Leone 2026", () -> {
			versionReads.incrementAndGet();
			return "1.23.20";
		}, () -> guide, () -> "2026-10-31", new File(folder, "UserManual.pdf"));
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
				.andExpect(jsonPath("$.version").value("1.23.20"))
				.andExpect(jsonPath("$.cloud").value(false))
				.andExpect(jsonPath("$.cloudLoginNeeded").value(false))
				.andExpect(jsonPath("$.errorsShown").value(false))
				.andExpect(jsonPath("$.surveyGuide").value(false))
				.andExpect(jsonPath("$.manual").value(false))
				.andExpect(jsonPath("$.build").value("2026-10-31"))
				.andExpect(jsonPath("$.java").isNotEmpty())
				.andExpect(jsonPath("$.languages[0].code").value("FR"))
				.andExpect(jsonPath("$.languages[0].label").value("Français"))
				.andExpect(jsonPath("$.client").value(false));
	}

	@Test
	public void saysWhatTheHelpMenuAndTheCloudLoginNeed() throws Exception {
		guide = new File(folder, "guide.pdf");
		Files.write(guide.toPath(), "guide".getBytes(StandardCharsets.UTF_8));
		Files.write(new File(folder, "UserManual.pdf").toPath(), "manual".getBytes(StandardCharsets.UTF_8));
		when(properties.isCloudSyncEnabled()).thenReturn(true);
		when(properties.getOperator()).thenReturn(" ");
		when(properties.isExceptionShown()).thenReturn(true);
		when(properties.getOperationMode()).thenReturn(OperationMode.CLIENT_MODE);
		mvc.perform(get("/api/app")).andExpect(status().isOk())
				.andExpect(jsonPath("$.cloud").value(true))
				.andExpect(jsonPath("$.cloudLoginNeeded").value(true))
				.andExpect(jsonPath("$.errorsShown").value(true))
				.andExpect(jsonPath("$.surveyGuide").value(true))
				.andExpect(jsonPath("$.manual").value(true))
				.andExpect(jsonPath("$.client").value(true));
	}

	@Test
	public void theLanguageIsSavedAndAnUnknownOneRefused() throws Exception {
		mvc.perform(put("/api/app/language").contentType(MediaType.APPLICATION_JSON).content("{\"language\":\"es\"}"))
				.andExpect(status().isOk());
		verify(properties).setUiLanguage(UI_LANGUAGE.ES);
		mvc.perform(put("/api/app/language").contentType(MediaType.APPLICATION_JSON).content("{\"language\":\"xx\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("language.unknown"));
		// Back to English for the other tests: the texts of the server are set by it
		Messages.setLocale(UI_LANGUAGE.EN.getLocale());
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
