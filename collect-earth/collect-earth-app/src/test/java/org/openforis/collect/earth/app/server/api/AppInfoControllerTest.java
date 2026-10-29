package org.openforis.collect.earth.app.server.api;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** What the app bar shows and the operator it changes, answered as the server's own wiring does (see TemplateWiring). */
public class AppInfoControllerTest {

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final AppInfoController controller = new AppInfoController(properties, () -> "Sierra Leone 2026");
	private final MockMvc mvc = TemplateWiring.mockMvc(controller, new ApiExceptionHandler());

	public AppInfoControllerTest() throws Exception {
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
				.andExpect(jsonPath("$.plotsMap").value(true));
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
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("operator.cloud"));
		verify(properties, never()).saveOperator(anyString());
	}
}
