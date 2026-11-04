package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import freemarker.template.Configuration;

/**
 * The scripts Collect Earth runs in the pages of the imagery window, run by node on pages that play those sites on a
 * clock of their own: the Google Earth Web overlay (resources/javascript_google_earth_web.fmt and the camera decisions
 * it includes, javascript_google_earth_web_camera.js) - how soon the plot is drawn when GEW jumps or flies, that it is
 * never hidden for a camera GEW writes again, that a flight that happened not to change the URL is not taken for a
 * jump - and the zoom of ESRI Wayback (javascript_esri_wayback.fmt), no deeper than its imagery at the plot. The tests
 * themselves are in src/test/javascript; this renders the templates for them as Collect Earth does, and runs them.
 * Skipped where node is not on the PATH.
 */
public class ImageryPageScriptsTest {

	private static final Path SCRIPTS = Paths.get("target", "imagery-page-scripts");
	private static final Path TESTS = Paths.get("src", "test", "javascript");

	private static Configuration freemarker() throws IOException {
		Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
		cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
		cfg.setDirectoryForTemplateLoading(new File("."));
		return cfg;
	}

	private static String render(String template, Map<String, Object> data) throws Exception {
		StringWriter out = new StringWriter();
		freemarker().getTemplate(template).process(data, out);
		return out.toString();
	}

	private static Map<String, Object> coord(double lon, double lat) {
		Map<String, Object> c = new HashMap<>();
		c.put("longitude", lon);
		c.put("latitude", lat);
		return c;
	}

	/** A square plot of about 30 m around the point, with one sample point in its middle. */
	private static Map<String, Object> placemark(double lat, double lon) {
		double d = 0.00014;
		List<Map<String, Object>> ring = Arrays.asList(coord(lon - d, lat - d), coord(lon + d, lat - d),
				coord(lon + d, lat + d), coord(lon - d, lat + d), coord(lon - d, lat - d));
		double s = 0.00002;
		Map<String, Object> sample = new HashMap<>();
		sample.put("shape", Arrays.asList(coord(lon - s, lat - s), coord(lon + s, lat - s), coord(lon + s, lat + s),
				coord(lon - s, lat + s), coord(lon - s, lat - s)));
		Map<String, Object> placemark = new HashMap<>();
		placemark.put("multiShape", Arrays.asList(ring));
		placemark.put("points", Arrays.asList(sample));
		return placemark;
	}

	/**
	 * The overlay of the plot at the point, as GoogleEarthWebService renders it; the URL of the flight and the fly
	 * animation are left for the tests to fill ("__FLIGHT_URL__", "__FLY_ANIMATION__").
	 */
	private static String overlayScript(String plotId, double lat, double lon) throws Exception {
		Map<String, Object> data = new HashMap<>();
		data.put("placemark", placemark(lat, lon));
		data.put("plotId", plotId);
		data.put("plotLabel", plotId);
		data.put("plotUrl", GoogleEarthWebUrls.cameraUrl(String.valueOf(lat), String.valueOf(lon), 20, 128));
		data.put("inPageNavigation", "true");
		data.put("flightUrl", "__FLIGHT_URL__");
		data.put("flyAnimation", "__FLY_ANIMATION__");
		Map<String, String> labels = new LinkedHashMap<>();
		for (String k : new String[] { "plot", "hintTilted", "hintOutOfView", "hintUnavailable", "topDown", "topDownTooltip" }) {
			labels.put(k, k);
		}
		data.put("labels", labels);
		data.put("neighboursJson", "[]");
		return render("resources/javascript_google_earth_web.fmt", data);
	}

	/** The Wayback script of a plot of 30 m at 12.6919, -14.8026, as BrowserService renders it. */
	private static String waybackScript() throws Exception {
		Map<String, Object> data = new HashMap<>();
		data.put("placemark", placemark(12.6919, -14.8026));
		data.put("latitude", "12.6919");
		data.put("longitude", "-14.8026");
		data.put("viewHeightMeters", "80.7");
		data.put("maxZoom", String.valueOf(BrowserService.MAX_WAYBACK_ZOOM));
		return render("resources/javascript_esri_wayback.fmt", data);
	}

	private static boolean nodeIsThere() {
		try {
			Process p = new ProcessBuilder("node", "--version").redirectErrorStream(true)
					.redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
			return p.waitFor(30, TimeUnit.SECONDS) && p.exitValue() == 0;
		} catch (IOException e) {
			return false;
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			return false;
		}
	}

	private static void write(String name, String script) throws IOException {
		Files.write(SCRIPTS.resolve(name), script.getBytes(StandardCharsets.UTF_8));
	}

	@BeforeAll
	public static void renderTheScripts() throws Exception {
		Assumptions.assumeTrue(nodeIsThere(), "node is not on the PATH");
		Files.createDirectories(SCRIPTS);
		// Plots of the audit of 2026-11: id_7 and id_8, 278 km apart, and one 111 m from id_7
		write("plotA.js", overlayScript("A", 12.6919, -14.8026));
		write("plotB.js", overlayScript("B", 14.74772, -17.4766));
		write("plotC.js", overlayScript("C", 12.6929, -14.8026));
		// Collect Earth's own scripts, so that the tests send the camera as it does
		write("in-page-navigation.txt", GoogleEarthWebService.IN_PAGE_NAVIGATION_SCRIPT);
		write("camera-move.txt", GoogleEarthWebService.CAMERA_MOVE_SCRIPT);
		write("wayback.js", waybackScript());
	}

	/** Runs the node tests of the files; fails with their output. */
	private static void runNodeTests(String... files) throws Exception {
		List<String> command = new ArrayList<>(Arrays.asList("node", "--test"));
		for (String file : files) {
			command.add(TESTS.resolve(file).toString());
		}
		Path log = SCRIPTS.resolve(files[0] + ".log");
		ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(log.toFile());
		builder.environment().put("CE_IMAGERY_PAGE_SCRIPTS", SCRIPTS.toAbsolutePath().toString());
		Process node = builder.start();
		boolean ended = node.waitFor(120, TimeUnit.SECONDS);
		if (!ended) {
			node.destroyForcibly();
		}
		String output = new String(Files.readAllBytes(log), StandardCharsets.UTF_8);
		assertTrue(ended, "node did not end:\n" + output);
		assertEquals(0, node.exitValue(), output);
		assertTrue(output.contains("fail 0"), output);
	}

	@Test
	public void googleEarthWebDrawsThePlotAsSoonAsTheCameraIsThereAndNeverFlickers() throws Exception {
		runNodeTests("gew-camera.test.js", "gew-overlay.test.js");
	}

	@Test
	public void esriWaybackShowsThePlotNoDeeperThanItsImagery() throws Exception {
		runNodeTests("wayback-zoom.test.js");
	}
}
