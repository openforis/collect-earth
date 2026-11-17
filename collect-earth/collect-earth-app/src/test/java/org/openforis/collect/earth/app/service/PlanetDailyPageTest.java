package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;

/** The Planet Daily page asks this Collect Earth (its port), and one page per template is left in the temporary folder. */
public class PlanetDailyPageTest {

	private static SimplePlacemarkObject plot(String id) {
		SimplePlacemarkObject plot = new SimplePlacemarkObject(new String[] { "40.1", "-3.7" });
		plot.setPlacemarkId(id);
		plot.setShape(Arrays.asList(new SimpleCoordinate(40.1, -3.7), new SimpleCoordinate(40.2, -3.7),
				new SimpleCoordinate(40.2, -3.6), new SimpleCoordinate(40.1, -3.7)));
		plot.setPoints(Collections.emptyList());
		return plot;
	}

	private static URL page(GeolocalizeMapService service, String id) {
		return service.getUrlToFreemarkerOutput(plot(id), GeolocalizeMapService.FREEMARKER_PLANET_DAILY_HTML_TEMPLATE,
				"planetMapsKey", "k", "urlPlanetEndpointPrefix", "http://localhost:9000/earth/");
	}

	@Test
	public void thePageCallsTheConfiguredPortAndTheEarlierPageIsDeleted() throws Exception {
		GeolocalizeMapService service = new GeolocalizeMapService();
		File first = Paths.get(page(service, "1").toURI()).toFile();
		File second = Paths.get(page(service, "2").toURI()).toFile();
		try {
			assertFalse(first.exists(), "the page of the plot before, with the key and its place, is gone");
			String html = new String(Files.readAllBytes(second.toPath()), StandardCharsets.UTF_8);
			assertTrue(html.contains("http://localhost:9000/earth/planetTileUrl"), html);
			assertFalse(html.contains("8028"), html);
		} finally {
			second.delete();
		}
	}
}
