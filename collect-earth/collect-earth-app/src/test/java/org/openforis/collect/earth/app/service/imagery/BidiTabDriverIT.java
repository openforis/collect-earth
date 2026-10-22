package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.EnumSet;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.openqa.selenium.bidi.browsingcontext.BrowsingContext;
import org.openqa.selenium.bidi.browsingcontext.BrowsingContextInfo;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;

/**
 * {@link BidiTabDriver} in a real Firefox, through {@link ImageryBrowser}. Needs Firefox, and opens its window:
 * {@code mvn test -pl collect-earth-app -Dtest=BidiTabDriverIT -Dce.browserTests=true}
 */
@EnabledIfSystemProperty(named = "ce.browserTests", matches = "true")
public class BidiTabDriverIT {

	private static final Duration LOAD = Duration.ofSeconds(20);
	/**
	 * Far longer than the application's: on a busy machine Firefox took 28 s to start and a BiDi subscription over
	 * 20 s to answer, and the start of the browser is part of the first command. The tests are about what the driver
	 * does, not about how fast the machine is.
	 */
	private static final Duration PATIENCE = Duration.ofSeconds(120);

	private final List<BidiTabDriver> started = new CopyOnWriteArrayList<>();
	private final ImageryBrowser imagery = new ImageryBrowser(() -> {
		FirefoxOptions options = new FirefoxOptions();
		options.enableBiDi();
		BidiTabDriver driver = new BidiTabDriver(
				new FirefoxDriver(options, BidiTabDriver.clientConfig().wsTimeout(PATIENCE.dividedBy(2))));
		started.add(driver);
		return driver;
	}, new ImageryErrorReporterTest.RecordingReporter());

	@BeforeEach
	public void bePatient() {
		imagery.setCommandTimeout(PATIENCE);
	}

	@AfterEach
	public void stop() {
		imagery.shutdown();
		started.forEach(BidiTabDriver::quit);
	}

	@Test
	public void aBackgroundTabLoadsAndRunsScriptsWithoutBeingShown() throws Exception {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK));
		imagery.show(ImagerySource.GOOGLE_EARTH_WEB);
		ImageryTab shown = imagery.tab(ImagerySource.GOOGLE_EARTH_WEB);
		ImageryTab hidden = imagery.tab(ImagerySource.ESRI_WAYBACK);
		assertTrue(shown.load(page("shown"), false, LOAD));
		for (int i = 1; i <= 3; i++) {
			assertTrue(hidden.load(page("plot" + i), false, LOAD));
			assertEquals("plot" + i, hidden.evaluate("return document.title;"));
			assertEquals("visible", shown.evaluate("return document.visibilityState;"));
			assertEquals("hidden", hidden.evaluate("return document.visibilityState;"));
		}
		assertEquals(42L, hidden.evaluate("return arguments[0] * 2;", 21));
		// The visibility reports reach Collect Earth
		imagery.show(ImagerySource.ESRI_WAYBACK);
		assertTrue(hidden.waitUntil("return document.visibilityState === 'visible';", LOAD));
		waitFor(() -> imagery.visibleSource() == ImagerySource.ESRI_WAYBACK);
		assertEquals("hidden", shown.evaluate("return document.visibilityState;"));
	}

	@Test
	public void theTabTheBrowserOpenedWithIsABidiContext() {
		imagery.openTabs(EnumSet.of(ImagerySource.PLANET));
		BidiTabDriver driver = started.get(0);
		assertTrue(topLevel(driver).stream().anyMatch(context -> context.getId().equals(driver.initialTab())),
				"window handle " + driver.initialTab() + " is not among the browsing contexts");
		assertEquals("firefox", driver.browserName());
	}

	@Test
	public void theUserSelectingATabIsReported() throws Exception {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK));
		assertTrue(imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).load(page("gew"), false, LOAD));
		assertTrue(imagery.tab(ImagerySource.ESRI_WAYBACK).load(page("wayback"), false, LOAD));
		assertEquals(ImagerySource.GOOGLE_EARTH_WEB, imagery.visibleSource());
		// As the user clicking the tab: straight to the browser, not through Collect Earth
		BidiTabDriver driver = started.get(0);
		new BrowsingContext(driver.window(), contextShowing(driver, "wayback")).activate();
		waitFor(() -> imagery.visibleSource() == ImagerySource.ESRI_WAYBACK);
		new BrowsingContext(driver.window(), contextShowing(driver, "gew")).activate();
		waitFor(() -> imagery.visibleSource() == ImagerySource.GOOGLE_EARTH_WEB);
	}

	@Test
	public void aTabTheUserClosedIsOpenedAgainWhenNeeded() throws Exception {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK));
		ImageryTab wayback = imagery.tab(ImagerySource.ESRI_WAYBACK);
		assertTrue(wayback.load(page("wayback"), false, LOAD));
		BidiTabDriver driver = started.get(0);
		new BrowsingContext(driver.window(), contextShowing(driver, "wayback")).close();
		waitFor(() -> !wayback.isOpen());
		assertTrue(driver.isAlive(), "a tab closed, not the browser");
		assertTrue(wayback.load(page("wayback again"), false, LOAD));
		assertTrue(wayback.isOpen());
		assertEquals("wayback again", wayback.evaluate("return document.title;"));
		assertEquals(1, started.size());
	}

	@Test
	public void aWindowTheUserClosedIsOpenedAgainWhenNeeded() {
		ImageryTab planet = imagery.tab(ImagerySource.PLANET);
		assertTrue(planet.load(page("planet"), false, LOAD));
		BidiTabDriver first = started.get(0);
		first.window().close(); // its only tab: the browser ends
		assertThrows(TabClosedException.class, () -> planet.evaluate("return 1;"));
		assertFalse(first.isAlive());
		assertFalse(planet.isOpen());
		assertTrue(planet.load(page("planet again"), false, LOAD));
		assertEquals(2, started.size());
		assertEquals("planet again", planet.evaluate("return document.title;"));
	}

	@Test
	public void aScriptThatThrowsIsAPageScriptException() {
		ImageryTab tab = imagery.tab(ImagerySource.PLANET);
		assertTrue(tab.load(page("planet"), false, LOAD));
		PageScriptException thrown = assertThrows(PageScriptException.class,
				() -> tab.evaluate("throw new Error('boom');"));
		assertTrue(thrown.getMessage().contains("boom"), thrown.getMessage());
		assertTrue(tab.isOpen(), "a script error leaves the tab as it is");
	}

	@Test
	public void aReloadLoadsANewDocumentWhenOnlyTheFragmentChanges() {
		ImageryTab tab = imagery.tab(ImagerySource.GOOGLE_EARTH_WEB);
		assertTrue(tab.load(page("map") + "#a", false, LOAD));
		tab.evaluate("window.stamp = 1;");
		assertTrue(tab.load(page("map") + "#b", true, LOAD));
		assertNull(tab.evaluate("return window.stamp === undefined ? null : window.stamp;"));
		assertEquals("#b", tab.evaluate("return location.hash;"));
	}

	@Test
	public void aQuitDriverIsNotAliveAndQuitsOnce() {
		imagery.openTabs(EnumSet.of(ImagerySource.PLANET));
		BidiTabDriver driver = started.get(0);
		assertTrue(driver.isAlive());
		driver.quit();
		assertFalse(driver.isAlive());
		driver.quit();
		assertThrows(TabClosedException.class, () -> driver.evaluate(driver.initialTab(), "1"));
	}

	private static String page(String title) {
		return "data:text/html,<title>" + title.replace(" ", "%20") + "</title>";
	}

	private static List<BrowsingContextInfo> topLevel(BidiTabDriver driver) {
		return new BrowsingContext(driver.window(), driver.initialTab()).getTopLevelContexts();
	}

	/** The tab with this page, found by its URL, as Collect Earth does not tell which tab is which. */
	private static String contextShowing(BidiTabDriver driver, String title) {
		String url = page(title);
		return topLevel(driver).stream().filter(context -> decode(context.getUrl()).equals(decode(url))).findFirst()
				.orElseThrow(() -> new AssertionError("no tab shows " + url)).getId();
	}

	/** The browser may give the URL back percent-encoded. */
	private static String decode(String url) {
		return URLDecoder.decode(url, StandardCharsets.UTF_8);
	}

	private static void waitFor(BooleanSupplier condition) throws InterruptedException {
		long end = System.nanoTime() + Duration.ofSeconds(15).toNanos();
		while (!condition.getAsBoolean()) {
			if (System.nanoTime() > end) {
				throw new AssertionError("timed out");
			}
			Thread.sleep(20);
		}
	}
}
