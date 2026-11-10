package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.Collections;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.openforis.collect.earth.app.service.BrowserService;
import org.openqa.selenium.bidi.browsingcontext.BrowsingContext;
import org.openqa.selenium.bidi.browsingcontext.BrowsingContextInfo;
import org.openqa.selenium.bidi.module.Permission;
import org.openqa.selenium.bidi.permissions.PermissionState;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;

import com.sun.net.httpserver.HttpServer;

/**
 * The plots map in its panel of Google Earth Web's page (resources/javascript_plots_map_panel.fmt) in a real Firefox:
 * the page is served by this computer, which Firefox 153 refuses a public site until the permissions of
 * {@link BrowserService#LOCAL_NETWORK_PERMISSIONS} are granted to it, as BrowserService does. Without them the frame
 * stayed blank, with nothing said. A page of its own stands for the plots map, served at 127.0.0.1 with the headers of
 * GoogleEarthHeaderFilter. Needs Firefox and the internet:
 * {@code mvn test -pl collect-earth-app -Dtest=PlotsMapPanelFirefoxIT -Dce.browserTests=true}
 */
@EnabledIfSystemProperty(named = "ce.browserTests", matches = "true")
public class PlotsMapPanelFirefoxIT {

	private static final String GOOGLE_EARTH_WEB = "https://earth.google.com";
	private static final long PATIENCE_MILLIS = 60_000;

	private HttpServer server;
	private BidiTabDriver driver;

	@AfterEach
	public void stop() {
		if (driver != null) {
			driver.quit();
		}
		if (server != null) {
			server.stop(0);
		}
	}

	@Test
	public void thePlotsMapShowsInItsPanelOnceGoogleEarthWebMayLoadThePagesOfThisComputer() throws Exception {
		server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
		server.createContext("/earth/map", exchange -> {
			byte[] page = "<!DOCTYPE html><title>plots map</title><body><div id=root>Plots</div></body>".getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().add("Content-Type", "text/html; charset=utf-8");
			exchange.getResponseHeaders().add("Cross-Origin-Resource-Policy", "cross-origin");
			exchange.getResponseHeaders().add("Cross-Origin-Embedder-Policy", "credentialless");
			exchange.sendResponseHeaders(200, page.length);
			exchange.getResponseBody().write(page);
			exchange.close();
		});
		server.start();
		String panel = "http://127.0.0.1:" + server.getAddress().getPort() + "/earth/map?panel";

		FirefoxOptions options = new FirefoxOptions();
		options.enableBiDi();
		FirefoxDriver firefox = new FirefoxDriver(options, BidiTabDriver.clientConfig().wsTimeout(Duration.ofSeconds(60)));
		driver = new BidiTabDriver(firefox);
		Permission permission = new Permission(firefox);
		int granted = 0;
		for (String name : BrowserService.LOCAL_NETWORK_PERMISSIONS) {
			try {
				permission.setPermission(Collections.singletonMap("name", name), PermissionState.GRANTED, GOOGLE_EARTH_WEB);
				granted++;
			} catch (RuntimeException e) {
				// Chrome's name: Firefox does not know it
			}
		}
		assertTrue(granted > 0, "Firefox knows none of " + BrowserService.LOCAL_NETWORK_PERMISSIONS);

		String tab = driver.initialTab();
		driver.navigate(tab, GOOGLE_EARTH_WEB + "/web/");
		String script = new String(Files.readAllBytes(Paths.get("resources/javascript_plots_map_panel.fmt")), StandardCharsets.UTF_8);
		String injected = null;
		long end = System.currentTimeMillis() + PATIENCE_MILLIS;
		while (!"\"shown\"".equals(injected) && System.currentTimeMillis() < end) {
			Thread.sleep(1000);
			try {
				injected = driver.evaluate(tab, ImageryTab.expression(script, panel, "Test - Google Earth Web - Collect Earth"));
			} catch (PageScriptException e) {
				// the page is still loading
			}
		}
		assertEquals("\"shown\"", injected);

		String text = null;
		while (!"Plots".equals(text) && System.currentTimeMillis() < end) {
			Thread.sleep(500);
			String frame = frameShowing(firefox, tab, panel);
			if (frame != null) {
				try {
					text = driver.evaluate(frame, "document.getElementById('root') ? document.getElementById('root').textContent : ''");
				} catch (PageScriptException e) {
					// loading
				}
			}
		}
		assertEquals("Plots", text, "the plots map did not load in its panel");
	}

	/** The frame of the page that has loaded the panel's address, or null. */
	private static String frameShowing(FirefoxDriver firefox, String tab, String url) {
		for (BrowsingContextInfo top : new BrowsingContext(firefox, tab).getTree()) {
			if (top.getChildren() != null) {
				for (BrowsingContextInfo child : top.getChildren()) {
					if (url.equals(child.getUrl())) {
						return child.getId();
					}
				}
			}
		}
		return null;
	}
}
