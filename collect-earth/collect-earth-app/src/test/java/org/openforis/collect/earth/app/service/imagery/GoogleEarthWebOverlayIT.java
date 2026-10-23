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
 * of throwing; with a body, it arms. It redraws the outline for a window resized, and projects a plot across the
 * antimeridian, and waits for a drag held still to be released. Needs Firefox:
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

	/** The overlay script for a plot of the given ring, as GoogleEarthWebService renders it. */
	static String overlayScript(List<Map<String, Object>> ring) throws Exception {
		Configuration cfg = new Configuration(Configuration.VERSION_2_3_32);
		cfg.setDirectoryForTemplateLoading(new File("."));
		Map<String, Object> data = new HashMap<>();
		Map<String, Object> placemark = new HashMap<>();
		placemark.put("multiShape", Arrays.asList(ring));
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
		return out.toString();
	}

	/** Waits for the outline to be shown ("block") or hidden ("none"); false if it is not within the time. */
	static boolean outlineBecomes(ImageryTab tab, String display, long millis) throws InterruptedException {
		long end = System.currentTimeMillis() + millis;
		while (System.currentTimeMillis() < end) {
			if (display.equals(tab.evaluate("return document.querySelector('svg[data-ce-overlay]').style.display;"))) {
				return true;
			}
			Thread.sleep(100);
		}
		return false;
	}

	/** A page whose address holds a Google Earth Web camera, top-down over {@code lat, lon}. */
	static String pageWithCamera(double lat, double lon) {
		return "data:text/html,<html><head><title>x</title></head><body>hi</body></html>#@" + lat + "," + lon
				+ ",0a,500d,35y,0h,0t,0r";
	}

	@Test
	public void aDocumentWithoutABodyIsLeftForLater() throws Exception {
		imagery.setCommandTimeout(Duration.ofSeconds(120));
		String script = overlayScript(Arrays.asList(coord(1, 1), coord(1.001, 1), coord(1.001, 1.001), coord(1, 1)));

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

	@Test
	public void aResizedWindowHasItsOutlineRedrawn() throws Exception {
		imagery.setCommandTimeout(Duration.ofSeconds(120));
		ImageryTab tab = imagery.tab(ImagerySource.GOOGLE_EARTH_WEB);
		assertTrue(tab.load(pageWithCamera(1.0005, 1.0005), false, Duration.ofSeconds(20)));
		assertEquals("armed", tab.evaluate(overlayScript(Arrays.asList(coord(1, 1), coord(1.001, 1), coord(1.001, 1.001), coord(1, 1)))));
		assertTrue(outlineBecomes(tab, "block", 5000), "drawn once the camera is still");
		// The rings drawn now are marked: a redraw replaces them
		tab.evaluate("document.querySelectorAll('[data-ce-ring]').forEach(function (r) { r.setAttribute('data-old', '1'); });");
		tab.evaluate("window.dispatchEvent(new Event('resize'));");
		assertTrue(outlineBecomes(tab, "none", 1000), "hidden while the window is resized");
		assertTrue(outlineBecomes(tab, "block", 6000), "drawn again for the new size");
		assertEquals(true, tab.evaluate("return document.querySelectorAll('[data-old]').length === 0;"));
	}

	@Test
	public void aPlotAcrossTheAntimeridianIsDrawnWhereItIs() throws Exception {
		imagery.setCommandTimeout(Duration.ofSeconds(120));
		ImageryTab tab = imagery.tab(ImagerySource.GOOGLE_EARTH_WEB);
		// The camera just west of the antimeridian, the plot just east of it: a few metres apart
		assertTrue(tab.load(pageWithCamera(1.0002, -179.9999), false, Duration.ofSeconds(20)));
		assertEquals("armed", tab.evaluate(overlayScript(Arrays.asList(coord(179.9997, 1), coord(179.9999, 1),
				coord(179.9999, 1.0004), coord(179.9997, 1.0004), coord(179.9997, 1)))));
		assertTrue(outlineBecomes(tab, "block", 5000), "drawn once the camera is still");
		// In view: no "out of view" hint, and every point on the screen
		assertEquals("none", tab.evaluate("return document.querySelector('[data-ce-hint]').style.display;"));
		assertEquals(true, tab.evaluate("var ok = true; document.querySelector('[data-ce-ring=plot]').getAttribute('points')"
				+ ".split(' ').forEach(function (p) { var xy = p.split(',').map(Number);"
				+ " ok = ok && xy[0] >= 0 && xy[0] <= innerWidth && xy[1] >= 0 && xy[1] <= innerHeight; }); return ok;"));
	}

	@Test
	public void aDragHeldStillKeepsTheOutlineHiddenUntilReleased() throws Exception {
		imagery.setCommandTimeout(Duration.ofSeconds(120));
		ImageryTab tab = imagery.tab(ImagerySource.GOOGLE_EARTH_WEB);
		assertTrue(tab.load(pageWithCamera(1.0005, 1.0005), false, Duration.ofSeconds(20)));
		assertEquals("armed", tab.evaluate(overlayScript(Arrays.asList(coord(1, 1), coord(1.001, 1), coord(1.001, 1.001), coord(1, 1)))));
		assertTrue(outlineBecomes(tab, "block", 5000), "drawn once the camera is still");
		String mouse = "document.body.dispatchEvent(new MouseEvent(arguments[0], { bubbles: true, buttons: arguments[1] }));";
		tab.evaluate(mouse, "mousedown", 1);
		tab.evaluate(mouse, "mousemove", 1);
		assertTrue(outlineBecomes(tab, "none", 1000), "hidden while dragged");
		// Held still for longer than a move is waited for, with the URL unchanged: not drawn from the old camera
		assertTrue(!outlineBecomes(tab, "block", 5500), "not drawn while the button is held");
		// A move with no button down: released outside the window
		tab.evaluate(mouse, "mousemove", 0);
		assertTrue(outlineBecomes(tab, "block", 6000), "drawn once released");
	}

	@Test
	public void aDragEndsWhenTheWindowLosesTheMouse() throws Exception {
		imagery.setCommandTimeout(Duration.ofSeconds(120));
		ImageryTab tab = imagery.tab(ImagerySource.GOOGLE_EARTH_WEB);
		assertTrue(tab.load(pageWithCamera(1.0005, 1.0005), false, Duration.ofSeconds(20)));
		assertEquals("armed", tab.evaluate(overlayScript(Arrays.asList(coord(1, 1), coord(1.001, 1), coord(1.001, 1.001), coord(1, 1)))));
		assertTrue(outlineBecomes(tab, "block", 5000), "drawn once the camera is still");
		String mouse = "document.body.dispatchEvent(new MouseEvent(arguments[0], { bubbles: true, buttons: arguments[1] }));";
		tab.evaluate(mouse, "mousedown", 1);
		tab.evaluate(mouse, "mousemove", 1);
		assertTrue(outlineBecomes(tab, "none", 1000), "hidden while dragged");
		// An element losing the focus does not end it
		tab.evaluate("document.body.dispatchEvent(new FocusEvent('blur'));");
		assertTrue(!outlineBecomes(tab, "block", 4500), "not drawn while the button is held");
		// The window losing it (minimized, another one in front) does: no mouseup comes
		tab.evaluate("window.dispatchEvent(new FocusEvent('blur'));");
		assertTrue(outlineBecomes(tab, "block", 6000), "drawn once the window lost the mouse");
	}
}
