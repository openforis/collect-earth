package org.openforis.collect.earth.app.service.settings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.settings.SettingsService.InvalidSettingsException;

/** The settings read, checked and saved for the page, over a stood-in earth.properties. */
public class SettingsServiceTest {

	private final Map<String, String> stored = new HashMap<>();
	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final AtomicInteger restarts = new AtomicInteger();
	private final AtomicInteger reloads = new AtomicInteger();
	private final SettingsService service = new SettingsService(properties,
			new SettingsValidator(new SettingsModel(LocalDate.of(2026, 10, 30)), f -> true, () -> LocalDate.of(2026, 10, 30)),
			restarts::incrementAndGet, reloads::incrementAndGet);

	@BeforeEach
	public void aStoredProject() {
		stored.put("sample_shape", "SQUARE");
		stored.put("number_of_sampling_points_in_plot", "25");
		stored.put("distance_between_sample_points", "10");
		stored.put("distance_to_plot_boundaries", "0");
		stored.put("inner_point_side", "2");
		stored.put("db_driver", "SQLITE");
		stored.put("use_browser", "firefox");
		stored.put("port", "8028");
		stored.put("csv", "C:/plots.csv");
		when(properties.getValue(any(EarthProperty.class))).thenAnswer(call -> {
			String value = stored.get(call.getArgument(0).toString());
			return value == null ? "" : value;
		});
		when(properties.getViewerType()).thenReturn("plots_map");
		when(properties.getWindowLayout()).thenReturn("auto");
		when(properties.getMapEngine()).thenReturn("leaflet");
		when(properties.getWebForm()).thenReturn("generated");
		when(properties.getCollectDBDriver()).thenReturn(CollectDBDriver.SQLITE);
	}

	@Test
	public void theCurrentValuesAreTheStoredOnesAsTheDialogShowedThem() {
		stored.put("distance_to_buffers", "30,60");
		stored.put("open_gee_app", "");
		stored.put("large_central_plot_side", "");
		stored.put("db_password", " secret ");
		Map<String, String> current = service.current();
		assertEquals("C:/plots.csv", current.get("csv"));
		assertEquals("SQUARE", current.get("sample_shape"));
		assertEquals("25", current.get("number_of_sampling_points_in_plot"));
		// The viewer as resolved from the legacy flags, the driver as resolved
		assertEquals("plots_map", current.get("viewer_type"));
		assertEquals("SQLITE", current.get("db_driver"));
		// Projects older than the reference area setting: a distance means a square one
		assertEquals("SQUARE", current.get("buffer_shape"));
		assertEquals("30", current.get("distance_to_buffers"));
		// A blank switch is off, a blank number its default, a password as it is
		assertEquals("false", current.get("open_gee_app"));
		assertEquals("20", current.get("large_central_plot_side"));
		assertEquals(" secret ", current.get("db_password"));
		assertEquals(service.getModel().settings().size(), current.size());
	}

	@Test
	public void validChangesAreWrittenTogetherAndThePlotsReloaded() throws Exception {
		Map<String, String> changes = new LinkedHashMap<>();
		changes.put("number_of_sampling_points_in_plot", "4");
		changes.put("distance_between_sample_points", " 20 ");
		// The same as stored: not written
		changes.put("csv", "C:/plots.csv");
		assertFalse(service.save(changes));
		ArgumentCaptor<Map<String, String>> written = ArgumentCaptor.forClass(Map.class);
		verify(properties).setValues(written.capture());
		Map<String, String> expected = new LinkedHashMap<>();
		expected.put("number_of_sampling_points_in_plot", "4");
		expected.put("distance_between_sample_points", "20");
		assertEquals(expected, written.getValue());
		verify(properties, never()).setValue(any(), any());
		assertEquals(1, reloads.get());
		assertEquals(0, restarts.get());
	}

	@Test
	public void aSettingANewServerReadsRestartsWhenItChanges() throws Exception {
		Map<String, String> changes = new HashMap<>();
		changes.put("db_driver", "POSTGRESQL");
		changes.put("db_host", "db.example.org");
		changes.put("db_name", "collect");
		changes.put("db_username", "earth");
		assertTrue(service.save(changes));
		assertEquals(1, restarts.get());
		assertEquals(0, reloads.get());
		verify(properties, times(1)).setValues(anyMap());
	}

	@Test
	public void theSameValueSentAgainDoesNotRestart() throws Exception {
		Map<String, String> changes = new HashMap<>();
		changes.put("db_driver", "SQLITE");
		changes.put("use_browser", "firefox");
		assertFalse(service.save(changes));
		assertEquals(0, restarts.get());
		// Nothing changed: nothing written, nothing reloaded either
		verify(properties, never()).setValues(anyMap());
		assertEquals(0, reloads.get());
	}

	@Test
	public void hiddenChangesAreDroppedAndTheSettingsBlankedWhenHiddenAreWrittenBlank() throws Exception {
		stored.put("large_central_plot_side", "30");
		Map<String, String> changes = new HashMap<>();
		// Hidden with SQLite: not written, and its being blank is no error
		changes.put("db_host", "db.example.org");
		// One point: the distance between them is hidden, and saved blank; the margin stays
		changes.put("number_of_sampling_points_in_plot", "1");
		assertFalse(service.save(changes));
		ArgumentCaptor<Map<String, String>> written = ArgumentCaptor.forClass(Map.class);
		verify(properties).setValues(written.capture());
		Map<String, String> expected = new HashMap<>();
		expected.put("number_of_sampling_points_in_plot", "1");
		expected.put("distance_between_sample_points", "");
		// The central plot side of a plain square, stored from another shape, is blanked too
		expected.put("large_central_plot_side", "");
		assertEquals(expected, written.getValue());
	}

	@Test
	public void aHiddenSettingKeepsItsValue() throws Exception {
		stored.put("distance_to_buffers", "50");
		stored.put("buffer_shape", "SQUARE");
		Map<String, String> changes = new HashMap<>();
		changes.put("buffer_shape", "NONE");
		service.save(changes);
		ArgumentCaptor<Map<String, String>> written = ArgumentCaptor.forClass(Map.class);
		verify(properties).setValues(written.capture());
		assertEquals(Collections.singletonMap("buffer_shape", "NONE"), written.getValue());
	}

	@Test
	public void invalidChangesAreRefusedAndNothingIsWritten() {
		Map<String, String> changes = new HashMap<>();
		changes.put("port", "99999");
		changes.put("csv", "D:/other.csv");
		InvalidSettingsException refused = assertThrows(InvalidSettingsException.class, () -> service.save(changes));
		assertTrue(refused.getErrors().containsKey("port"));
		verify(properties, never()).setValues(anyMap());
		assertEquals(0, reloads.get() + restarts.get());
	}

	@Test
	public void validateChecksTheStoredValuesWithTheOnesGivenOverThem() {
		Map<String, String> given = new HashMap<>();
		given.put("buffer_shape", "SQUARE");
		given.put("distance_to_buffers", "5");
		Validation validation = service.validate(given);
		assertTrue(validation.getErrors().containsKey("distance_to_buffers"));
		assertEquals(21, validation.getPlot().getMinReferenceDistance());
		assertTrue(service.validate(Collections.emptyMap()).isValid());
	}
}
