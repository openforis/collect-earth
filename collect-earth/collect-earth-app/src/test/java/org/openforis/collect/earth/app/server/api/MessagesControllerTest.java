package org.openforis.collect.earth.app.server.api;

import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Locale;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

/** The texts of the Swing UI for the pages, as the server's own wiring writes them (see TemplateWiring). */
public class MessagesControllerTest {

	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new MessagesController(), new ApiExceptionHandler());
	}

	@Test
	public void givesTheTextsOfTheLanguage() throws Exception {
		mvc.perform(get("/api/messages").param("lang", "es")).andExpect(status().isOk())
				.andExpect(jsonPath("$.language").value("es"))
				.andExpect(jsonPath("$.texts['CollectEarthMenu.0']").value("Importar archivo CEP"))
				.andExpect(jsonPath("$.texts['CollectEarthWindow.11']").exists());
	}

	@Test
	public void accentsComeOutRight() throws Exception {
		// Messages_es.properties is ISO-8859-1, with some texts written as such and others as Unicode escapes
		mvc.perform(get("/api/messages").param("lang", "es"))
				.andExpect(jsonPath("$.texts['CollectEarthWindow.34']").value("Error de validación"))
				.andExpect(jsonPath("$.texts['ExternalServicesPanel.viewerTypeTooltip']").value(startsWith("Dónde")));
	}

	@Test
	public void aRegionOfALanguageGetsTheLanguage() throws Exception {
		mvc.perform(get("/api/messages").param("lang", "es-AR"))
				.andExpect(jsonPath("$.language").value("es"))
				.andExpect(jsonPath("$.texts['CollectEarthMenu.0']").value("Importar archivo CEP"));
	}

	@Test
	public void aLanguageWrittenWithAnUnderscoreIsUnderstood() throws Exception {
		// es_AR is how Java writes a Locale, but it is not a language tag: Locale.forLanguageTag would give English
		mvc.perform(get("/api/messages").param("lang", "es_AR"))
				.andExpect(jsonPath("$.language").value("es"))
				.andExpect(jsonPath("$.texts['CollectEarthMenu.0']").value("Importar archivo CEP"));
	}

	@Test
	public void anUnknownLanguageGetsEnglish() throws Exception {
		mvc.perform(get("/api/messages").param("lang", "xx"))
				.andExpect(jsonPath("$.language").value("en"))
				.andExpect(jsonPath("$.texts['CollectEarthMenu.0']").value("Import CEP file"));
	}

	@Test
	public void anUnknownLanguageGetsEnglishWhateverTheUiLanguage() throws Exception {
		// Messages.setLocale makes the UI language the JVM's default one, which ResourceBundle would otherwise fall back to
		Locale before = Locale.getDefault();
		Locale.setDefault(Locale.FRENCH);
		try {
			mvc.perform(get("/api/messages").param("lang", "xx"))
					.andExpect(jsonPath("$.language").value("en"))
					.andExpect(jsonPath("$.texts['CollectEarthMenu.0']").value("Import CEP file"));
		} finally {
			Locale.setDefault(before);
		}
	}

	@Test
	public void theLanguageIsRequired() throws Exception {
		mvc.perform(get("/api/messages")).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("bad-request"));
	}
}
