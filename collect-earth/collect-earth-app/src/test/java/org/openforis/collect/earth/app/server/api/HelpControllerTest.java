package org.openforis.collect.earth.app.server.api;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

public class HelpControllerTest {

	@TempDir
	File folder;
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private File resources;
	private File data;
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		resources = new File(folder, "resources");
		data = new File(folder, "data");
		resources.mkdirs();
		data.mkdirs();
		when(properties.getUiLanguage()).thenReturn(UI_LANGUAGE.ES);
		mvc = TemplateWiring.mockMvc(new HelpController(properties, resources, data), new ApiExceptionHandler());
	}

	private void write(File file, String text) throws Exception {
		Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
	}

	@Test
	public void theDisclaimerIsTheOneOfTheUiLanguageElseTheEnglishOne() throws Exception {
		write(new File(resources, "disclaimer_en.txt"), "FAO disclaimer");
		mvc.perform(get("/api/help/text").param("name", "disclaimer")).andExpect(status().isOk())
				.andExpect(jsonPath("$.text").value("FAO disclaimer"))
				.andExpect(jsonPath("$.path").value(new File(resources, "disclaimer_en.txt").getAbsolutePath()));
		write(new File(resources, "disclaimer_es.txt"), "Aviso de la FAO");
		mvc.perform(get("/api/help/text").param("name", "disclaimer")).andExpect(jsonPath("$.text").value("Aviso de la FAO"));
	}

	@Test
	public void aMissingTextIsNotFound() throws Exception {
		mvc.perform(get("/api/help/text").param("name", "disclaimer")).andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error").value("help.missing"));
		mvc.perform(get("/api/help/text").param("name", "log")).andExpect(status().isNotFound());
		mvc.perform(get("/api/help/text").param("name", "secrets")).andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error").value("help.unknown"));
	}

	@Test
	public void theLogIsShownFromItsEnd() throws Exception {
		StringBuilder log = new StringBuilder();
		for (int i = 0; i < 20000; i++) {
			log.append("INFO line ").append(i).append('\n');
		}
		log.append("ERROR the last line\n");
		write(new File(data, "earth_error.log"), log.toString());
		mvc.perform(get("/api/help/text").param("name", "log")).andExpect(status().isOk())
				.andExpect(jsonPath("$.text").value(org.hamcrest.Matchers.allOf(
						org.hamcrest.Matchers.endsWith("ERROR the last line\n"),
						org.hamcrest.Matchers.startsWith("INFO line "),
						org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("INFO line 0\n")))));
	}

	@Test
	public void showingTheErrorsIsSaved() throws Exception {
		mvc.perform(put("/api/help/errorsShown").contentType(MediaType.APPLICATION_JSON).content("{\"shown\":true}")).andExpect(status().isOk());
		verify(properties).setExceptionShown(true);
	}
}
