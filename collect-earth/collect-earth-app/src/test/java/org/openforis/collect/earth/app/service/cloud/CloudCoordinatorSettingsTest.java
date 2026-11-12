package org.openforis.collect.earth.app.service.cloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
import org.openforis.collect.earth.app.view.Messages;

/** The coordinator's plot layout, changed on the dashboard, applied by Collect Earth during its cloud sync. */
public class CloudPlotLayoutTest {

	private final LocalPropertiesService properties = mock(LocalPropertiesService.class);
	private final Map<String, String> stored = new HashMap<>();
	private final Map<String, String> server = new LinkedHashMap<>();
	private final NoticeService notices = new NoticeService();
	private final AtomicInteger reloads = new AtomicInteger();
	private final AtomicInteger asked = new AtomicInteger();
	private CloudPlotLayout layout;

	@BeforeEach
	public void aCloudProject() {
		stored.put("sample_shape", "SQUARE");
		stored.put("number_of_sampling_points_in_plot", "25");
		stored.put("distance_between_sample_points", "10");
		stored.put("csv", "/projects/kenya/assignments/maria.csv");
		stored.put("db_driver", "CLOUD");
		server.put("sample_shape", "SQUARE");
		server.put("number_of_sampling_points_in_plot", "25");
		server.put("distance_between_sample_points", "10");
		when(properties.getValue(any(EarthProperty.class))).thenAnswer(call -> stored.getOrDefault(call.getArgument(0).toString(), ""));
		doAnswer(call -> stored.put(call.getArgument(0).toString(), call.getArgument(1))).when(properties).setValue(any(), any());
		layout = new CloudPlotLayout(properties, () -> {
			asked.incrementAndGet();
			return server;
		}, notices, reloads::incrementAndGet);
	}

	@Test
	public void theSettingsOfThePlotSectionAreTheOnesItLooksAt() {
		List<EarthProperty> plot = CloudPlotLayout.plotProperties();
		assertTrue(plot.contains(EarthProperty.SAMPLE_SHAPE));
		assertTrue(plot.contains(EarthProperty.DISTANCE_TO_BUFFERS));
		assertTrue(!plot.contains(EarthProperty.SAMPLE_FILE));
	}

	@Test
	public void theSameLayoutChangesNothing() {
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
		assertEquals(CloudPlotLayout.NOTICE, pending.get(0).get("kind"));
		String described = Messages.getString("SettingsPage.shape.CIRCLE") + MessageFormat.format(Messages.getString("CloudPlotLayout.points"), "9");
		assertEquals(MessageFormat.format(Messages.getString("CloudPlotLayout.changed"), described), pending.get(0).get("message"));
		// Applied once: the next check finds nothing to do
		assertTrue(layout.check().isEmpty());
		assertEquals(1, reloads.get());
	}

	@Test
	public void theServerIsAskedEveryFewMinutesAndNotReachingItChangesNothing() {
		layout.checkIfDue(1_000L);
		layout.checkIfDue(1_000L + CloudPlotLayout.CHECK_INTERVAL_MS - 1);
		assertEquals(1, asked.get());
		layout.checkIfDue(1_000L + CloudPlotLayout.CHECK_INTERVAL_MS);
		assertEquals(2, asked.get());

		CloudPlotLayout offline = new CloudPlotLayout(properties, () -> {
			throw new IOException("HTTP 404");
		}, notices, reloads::incrementAndGet);
		assertTrue(offline.check().isEmpty());
		assertEquals(0, reloads.get());
	}
}
