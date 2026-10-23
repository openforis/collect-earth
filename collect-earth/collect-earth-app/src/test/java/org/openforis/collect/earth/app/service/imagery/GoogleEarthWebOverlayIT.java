package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.StringWriter;
import java.time.Duration;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;

import freemarker.template.Configuration;

/**
 * The Google Earth Web overlay template (resources/javascript_google_earth_web.fmt) in a real Firefox: in a document
 * that has no body yet, as when Google Earth Web redirects on its way to the app, it draws nothing and says so instead
 * of throwing; with a body, it arms. Needs Firefox:
 * {@code mvn test -pl collect-earth-app -Dtest=GoogleEarthWebOverlayIT -Dce.browserTests=true}
 */
@EnabledIfSystemProperty(named = "ce.browserTests", matches = "true")
public class GoogleEarthWebOverlayIT {

	private final List<BidiTabDriver> started = new CopyOnWriteArrayList<>();
	private final ImageryBrowser imagery = new ImageryBrowser(() -> {
		FirefoxOptions options = new FirefoxOptions();
		options.enableBiDi();
		BidiTabDriver driver = new BidiTabDriver(
				new FirefoxDriver(options, BidiTabDriver.clientConfig().wsTimeout(Duration.ofSeconds(60))));
		started.add(driver);
		return driver;
	}, new ImageryErrorReporterTest.RecordingReporter());

	@AfterEach
	public void stop() {
		imagery.shutdown();
		started.forEach(BidiTabDriver::quit);
	}

	static Map<String, Object> coord(double lon, double lat) {
		Map<String, Object> c = new HashMap<>();
		c.put("longitude", lon);
		c.put("latitude", lat);
		return c;
	}

	@Test
	public void aDocumentWithoutABodyIsLeftForLater() throws Exception {
		imagery.setCommandTimeout(Duration.ofSeconds(120));
		Configuration cfg = new Configuration(Configuration.VERSION_2_3_32);
		cfg.setDirectoryForTemplateLoading(new File("."));
		Map<String, Object> data = new HashMap<>();
		Map<String, Object> placemark = new HashMap<>();
		placemark.put("multiShape", Arrays.asList(Arrays.asList(coord(1, 1), coord(1.001, 1), coord(1.001, 1.001), coord(1, 1))));
		data.put("placemark", placemark);
		data.put("plotId", "p1");
		data.put("plotUrl", "https://earth.google.com/web/@1,1,0a,500d,35y,0h,0t,0r");
		data.put("inPageNavigation", "null");
		data.put("flightUrl", "");
		Map<String, String> labels = new LinkedHashMap<>();
		for (String k : new String[] { "plot", "hintTilted", "hintOutOfView", "hintUnavailable", "topDown", "topDownTooltip" }) {
			labels.put(k, k);
		}
		data.put("labels", labels);
		data.put("neighboursJson", "[]");
		StringWriter out = new StringWriter();
		cfg.getTemplate("resources/javascript_google_earth_web.fmt").process(data, out);
		String script = out.toString();

		ImageryTab tab = imagery.tab(ImagerySource.GOOGLE_EARTH_WEB);
		assertTrue(tab.load("data:text/html,<html><head><title>x</title></head><body>hi</body></html>", false, Duration.ofSeconds(20)));
		tab.evaluate("window.__savedBody = document.body; document.documentElement.removeChild(document.body);");
		assertEquals(null, tab.evaluate("return document.body;"));
		assertEquals("no_body", tab.evaluate(script));
		assertEquals(false, tab.evaluate("return !!window.__collectEarthGewOverlay;"));
		tab.evaluate("document.documentElement.appendChild(window.__savedBody);");
		assertEquals("armed", tab.evaluate(script));
		assertEquals(true, tab.evaluate("return !!window.__collectEarthGewOverlay && !!document.querySelector('svg[data-ce-overlay]');"));
	}
}
