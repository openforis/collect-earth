package org.openforis.collect.earth.app.server.api;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.openforis.collect.earth.app.server.api.SettingsController.CloudRequest;
import org.openforis.collect.earth.app.server.api.SettingsController.DatabaseRequest;
import org.openforis.collect.earth.app.service.settings.SettingsModel;
import org.openforis.collect.earth.app.service.settings.SettingsService;
import org.openforis.collect.earth.app.service.settings.SettingsService.InvalidSettingsException;
import org.openforis.collect.earth.app.service.settings.SettingsValidator;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** The settings for the page, answered as the server's own wiring does (see TemplateWiring). */
public class SettingsControllerTest {

	private static final LocalDate TODAY = LocalDate.of(2026, 10, 30);

	private final SettingsModel model = new SettingsModel(TODAY);
	private final SettingsService settings = mock(SettingsService.class);
	private DatabaseRequest databaseTested;
	private CloudRequest cloudTested;
	private String connectionAnswer = SettingsController.CONNECTION_OK;
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		when(settings.getModel()).thenReturn(model);
		Map<String, String> current = new LinkedHashMap<>();
		current.put("csv", "C:/plots.csv");
		current.put("db_driver", "SQLITE");
		when(settings.current()).thenReturn(current);
		SettingsController controller = new SettingsController(settings, () -> "C:/backup", () -> "192.168.1.5", request -> {
			databaseTested = request;
			return connectionAnswer;
		}, request -> {
			cloudTested = request;
			return connectionAnswer;
		});
		mvc = TemplateWiring.mockMvc(controller, new ApiExceptionHandler());
	}

	@Test
	public void saysWhatThePageDraws() throws Exception {
		mvc.perform(get("/api/settings")).andExpect(status().isOk())
				.andExpect(jsonPath("$.sections", hasSize(6)))
				.andExpect(jsonPath("$.sections[1].id").value("plot"))
				.andExpect(jsonPath("$.sections[1].fields[0].key").value("sample_shape"))
				.andExpect(jsonPath("$.sections[1].fields[0].choices[0].label").value("SettingsPage.shape.SQUARE"))
				.andExpect(jsonPath("$.values.csv").value("C:/plots.csv"))
				.andExpect(jsonPath("$.info.computerIp").value("192.168.1.5"))
				.andExpect(jsonPath("$.info.backupFolder").value("C:/backup"))
				.andExpect(jsonPath("$.info.cloudMode").value(false));
	}

	@Test
	public void validatesWhatThePageHolds() throws Exception {
		SettingsValidator validator = new SettingsValidator(model, f -> true, () -> TODAY);
		Map<String, String> values = new HashMap<>();
		values.put("sample_shape", "SQUARE");
		values.put("number_of_sampling_points_in_plot", "25");
		values.put("distance_between_sample_points", "10");
		values.put("distance_to_plot_boundaries", "0");
		values.put("inner_point_side", "2");
		values.put("buffer_shape", "SQUARE");
		values.put("distance_to_buffers", "5");
		values.put("port", "x");
		when(settings.validate(anyMap())).thenReturn(validator.validate(values));
		mvc.perform(post("/api/settings/validate").contentType(MediaType.APPLICATION_JSON)
				.content("{\"values\":{\"distance_to_buffers\":\"5\",\"port\":\"x\"}}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.errors.port").value(Messages.getString("PropertyValidators.portRange")))
				.andExpect(jsonPath("$.errors.distance_to_buffers").exists())
				.andExpect(jsonPath("$.plot.minReferenceDistance").value(21))
				.andExpect(jsonPath("$.plot.plotAreaHa").value(0.16));
		ArgumentCaptor<Map<String, String>> given = ArgumentCaptor.forClass(Map.class);
		verify(settings).validate(given.capture());
		assertEquals("5", given.getValue().get("distance_to_buffers"));
		assertEquals(2, given.getValue().size());
	}

	@Test
	public void savesTheChangesAndSaysWhetherCollectEarthRestarts() throws Exception {
		when(settings.save(anyMap())).thenReturn(true);
		mvc.perform(post("/api/settings").contentType(MediaType.APPLICATION_JSON).content("{\"values\":{\"use_browser\":\"chrome\"}}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.restart").value(true));
		ArgumentCaptor<Map<String, String>> changes = ArgumentCaptor.forClass(Map.class);
		verify(settings).save(changes.capture());
		assertEquals(Collections.singletonMap("use_browser", "chrome"), changes.getValue());
	}

	@Test
	public void refusesInvalidChangesWithTheErrorsByKey() throws Exception {
		when(settings.save(anyMap())).thenThrow(new InvalidSettingsException(Collections.singletonMap("port", "Port must be a number")));
		mvc.perform(post("/api/settings").contentType(MediaType.APPLICATION_JSON).content("{\"values\":{\"port\":\"x\"}}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("settings.invalid"))
				.andExpect(jsonPath("$.message").value(Messages.getString("PropertiesDialog.validationErrors")))
				.andExpect(jsonPath("$.errors.port").value("Port must be a number"));
	}

	@Test
	public void aBodyWithoutValuesIsNoChange() throws Exception {
		when(settings.save(anyMap())).thenReturn(false);
		mvc.perform(post("/api/settings").contentType(MediaType.APPLICATION_JSON).content("{}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.restart").value(false));
		verify(settings).save(Collections.emptyMap());
	}

	@Test
	public void triesThePostgreSqlConnectionWithTheValuesTyped() throws Exception {
		mvc.perform(post("/api/settings/testDatabase").contentType(MediaType.APPLICATION_JSON)
				.content("{\"host\":\"db.example.org\",\"port\":\"5432\",\"name\":\"collect\",\"username\":\"earth\",\"password\":\"pw\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true))
				.andExpect(jsonPath("$.message").value(SettingsController.CONNECTION_OK));
		assertEquals("db.example.org", databaseTested.host);
		assertEquals("5432", databaseTested.port);
		assertEquals("collect", databaseTested.name);
		assertEquals("earth", databaseTested.username);
		assertEquals("pw", databaseTested.password);
		connectionAnswer = "Connection refused";
		mvc.perform(post("/api/settings/testDatabase").contentType(MediaType.APPLICATION_JSON).content("{\"host\":\"nowhere\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(false))
				.andExpect(jsonPath("$.message").value("Connection refused"));
	}

	@Test
	public void triesTheCloudConnection() throws Exception {
		mvc.perform(post("/api/settings/testCloud").contentType(MediaType.APPLICATION_JSON)
				.content("{\"url\":\"https://cloud.example.org\",\"projectId\":\"p1\",\"token\":\"t\"}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true));
		assertEquals("https://cloud.example.org", cloudTested.url);
		assertEquals("p1", cloudTested.projectId);
		assertEquals("t", cloudTested.token);
	}
}
