package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.text.MessageFormat;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.service.settings.SettingsModel;
import org.openforis.collect.earth.app.view.Messages;

/** The coordinator's plot layout and imagery windows, changed on the dashboard, applied by Collect Earth during its cloud sync. */
public class CloudCoordinatorSettingsTest {

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final Map<String, String> stored = new HashMap<>();
	private final Map<String, String> server = new LinkedHashMap<>();
	private final Map<String, String> serverImagery = new LinkedHashMap<>();
	private final NoticeService notices = new NoticeService();
	private final AtomicInteger reloads = new AtomicInteger();
	private final AtomicInteger asked = new AtomicInteger();
	private CloudCoordinatorSettings layout;

	@BeforeEach
	public void aCloudProject() {
		stored.put("sample_shape", "SQUARE");
		stored.put("number_of_sampling_points_in_plot", "25");
		stored.put("distance_between_sample_points", "10");
		stored.put("csv", "/projects/kenya/assignments/maria.csv");
		stored.put("db_driver", "CLOUD");
		stored.put("open_earth_map", "true");
		stored.put("planet_maps_key", "PLAK-maria");
		server.put("sample_shape", "SQUARE");
		server.put("number_of_sampling_points_in_plot", "25");
		server.put("distance_between_sample_points", "10");
		serverImagery.put("open_earth_map", "true");
		when(properties.getValue(any(EarthProperty.class))).thenAnswer(call -> stored.getOrDefault(call.getArgument(0).toString(), ""));
		doAnswer(call -> stored.put(call.getArgument(0).toString(), call.getArgument(1))).when(properties).setValue(any(), any());
		layout = new CloudCoordinatorSettings(properties, () -> {
			asked.incrementAndGet();
			return server;
		}, () -> serverImagery, notices, reloads::incrementAndGet);
	}

	@Test
	public void theSettingsOfThePlotAndImagerySectionsAreTheOnesItLooksAtButThePlanetKey() {
		List<EarthProperty> plot = CloudCoordinatorSettings.coordinatorsProperties(SettingsModel.PLOT);
		assertTrue(plot.contains(EarthProperty.SAMPLE_SHAPE));
		assertTrue(plot.contains(EarthProperty.DISTANCE_TO_BUFFERS));
		assertFalse(plot.contains(EarthProperty.SAMPLE_FILE));
		List<EarthProperty> imagery = CloudCoordinatorSettings.coordinatorsProperties(SettingsModel.IMAGERY);
		assertTrue(imagery.contains(EarthProperty.OPEN_GEE_APP));
		assertTrue(imagery.contains(EarthProperty.EXTRA_MAP_URL));
		assertTrue(imagery.contains(EarthProperty.PLANET_TFO_DATE_TO));
		assertFalse(imagery.contains(EarthProperty.PLANET_MAPS_KEY));
	}

	@Test
	public void theSameSettingsChangeNothing() {
		assertTrue(layout.check().isEmpty());
		assertEquals(0, reloads.get());
		assertTrue(notices.pending().isEmpty());
	}

	@Test
	public void aChangedLayoutIsWrittenThePlotsDrawnAgainAndTheCollectorTold() {
		server.put("sample_shape", "CIRCLE");
		server.put("number_of_sampling_points_in_plot", "9");
		server.put("csv", "/elsewhere.csv"); // not a plot layout setting: left alone

		Map<String, String> changed = layout.check();

		assertEquals(2, changed.size());
		assertEquals("CIRCLE", stored.get("sample_shape"));
		assertEquals("9", stored.get("number_of_sampling_points_in_plot"));
		assertEquals("/projects/kenya/assignments/maria.csv", stored.get("csv"));
		assertEquals("CLOUD", stored.get("db_driver"));
		assertEquals(1, reloads.get());
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(1, pending.size());
		assertEquals(CloudCoordinatorSettings.NOTICE, pending.get(0).get("kind"));
		String described = Messages.getString("SettingsPage.shape.CIRCLE") + MessageFormat.format(Messages.getString("CloudPlotLayout.points"), "9");
		assertEquals(MessageFormat.format(Messages.getString("CloudPlotLayout.changed"), described), pending.get(0).get("message"));
		// Applied once: the next check finds nothing to do
		assertTrue(layout.check().isEmpty());
		assertEquals(1, reloads.get());
	}

	@Test
	public void changedImageryWindowsAreWrittenButNotThePlanetKeyAndTheCollectorTold() {
		serverImagery.put("open_earth_map", "false");
		serverImagery.put("open_esri_wayback", "true");
		serverImagery.put("extra_map_url", "https://maps.example.org/?lat=LATITUDE&lon=LONGITUDE");
		serverImagery.put("planet_maps_key", "PLAK-coordinator"); // the collector's own: left alone

		Map<String, String> changed = layout.check();

		assertEquals(3, changed.size());
		assertEquals("false", stored.get("open_earth_map"));
		assertEquals("true", stored.get("open_esri_wayback"));
		assertEquals("PLAK-maria", stored.get("planet_maps_key"));
		assertEquals(1, reloads.get());
		List<Map<String, Object>> pending = notices.pending();
		assertEquals(1, pending.size());
		assertEquals(CloudCoordinatorSettings.NOTICE_IMAGERY, pending.get(0).get("kind"));
		assertEquals(MessageFormat.format(Messages.getString("CloudImagery.changed"), "ESRI Wayback, Planet, maps.example.org"), pending.get(0).get("message"));
		assertTrue(layout.check().isEmpty());
	}

	@Test
	public void theServerIsAskedEveryFewMinutesAndNotReachingItChangesNothing() {
		layout.checkIfDue(1_000L);
		layout.checkIfDue(1_000L + CloudCoordinatorSettings.CHECK_INTERVAL_MS - 1);
		assertEquals(1, asked.get());
		layout.checkIfDue(1_000L + CloudCoordinatorSettings.CHECK_INTERVAL_MS);
		assertEquals(2, asked.get());

		CloudCoordinatorSettings offline = new CloudCoordinatorSettings(properties, () -> {
			throw new IOException("HTTP 404");
		}, () -> {
			throw new IOException("HTTP 404");
		}, notices, reloads::incrementAndGet);
		assertTrue(offline.check().isEmpty());
		assertEquals(0, reloads.get());
	}

	@Test
	public void aServerWithoutTheImageryStillGivesTheLayout() {
		server.put("sample_shape", "HEXAGON");
		CloudCoordinatorSettings older = new CloudCoordinatorSettings(properties, () -> server, () -> {
			throw new IOException("HTTP 404");
		}, notices, reloads::incrementAndGet);
		assertEquals(1, older.check().size());
		assertEquals("HEXAGON", stored.get("sample_shape"));
	}
}
