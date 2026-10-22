package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import java.util.concurrent.CountDownLatch;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

public class ImageryBrowserTest {

	private final FakeTabDriver browser = new FakeTabDriver();
	private int starts;
	private final ImageryBrowser imagery = new ImageryBrowser(() -> { starts++; return browser; },
			new ImageryErrorReporterTest.RecordingReporter());

	@AfterEach
	public void stop() {
		imagery.shutdown();
	}

	@Test
	public void theFirstSourceTakesTheTabTheBrowserOpenedWith() {
		imagery.tab(ImagerySource.ESRI_WAYBACK).navigate("https://wayback/1");
		assertEquals(Arrays.asList("navigate tab0 https://wayback/1"), browser.calls);
		assertEquals(1, starts);
	}

	@Test
	public void tabsAreOpenedInTheOrderOfTheSources() {
		imagery.openTabs(EnumSet.of(ImagerySource.EXTRA_MAP, ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.PLANET));
		assertEquals(Arrays.asList(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.PLANET, ImagerySource.EXTRA_MAP),
				imagery.openSources());
		assertEquals(Arrays.asList("create tab1", "create tab2"), browser.calls);
	}

	@Test
	public void aTabTheUserClosedIsOpenedAgainWhenItsSourceNeedsIt() {
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		browser.close("tab0");
		assertFalse(imagery.tab(ImagerySource.PLANET).isOpen());
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/2");
		assertTrue(browser.calls.contains("navigate tab1 https://planet/2"), browser.calls.toString());
	}

	@Test
	public void aClosedBrowserIsStartedAgain() {
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		browser.alive = false;
		FakeTabDriver second = new FakeTabDriver();
		imagery.setStarter(() -> second);
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/2");
		assertEquals(Arrays.asList("navigate tab0 https://planet/2"), second.calls);
	}

	@Test
	public void aScriptGetsItsArgumentsAndReturnsJson() {
		assertEquals("(() => { const r = (function () {return arguments[0] + 1;\n}).apply(null, [41]); "
				+ "return JSON.stringify(r === undefined ? null : r); })()",
				ImageryTab.expression("return arguments[0] + 1;", 41));
		browser.answers.put("location.href", "\"https://earth.google.com/web/\"");
		assertEquals("https://earth.google.com/web/", imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).currentUrl());
	}

	@Test
	public void theVisibleTabIsServedFirst() throws Exception {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK, ImagerySource.PLANET));
		browser.select("tab1"); // Wayback shown
		browser.calls.clear();
		CountDownLatch hold = new CountDownLatch(1);
		browser.holdFirstNavigate = hold;
		Thread first = new Thread(() -> imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("gew/0"));
		first.start();
		Thread.sleep(200); // the worker is now inside that navigate
		Thread planet = new Thread(() -> imagery.tab(ImagerySource.PLANET).navigate("planet/1"));
		planet.start();
		Thread.sleep(100);
		Thread wayback = new Thread(() -> imagery.tab(ImagerySource.ESRI_WAYBACK).navigate("wayback/1"));
		wayback.start();
		Thread.sleep(100);
		hold.countDown();
		first.join();
		planet.join();
		wayback.join();
		assertEquals(Arrays.asList("navigate tab0 gew/0", "navigate tab1 wayback/1", "navigate tab2 planet/1"),
				browser.calls);
	}

	@Test
	public void onlyTheLatestPlotOfASourceIsLoaded() throws Exception {
		List<String> loaded = Collections.synchronizedList(new ArrayList<>());
		CountDownLatch inFirst = new CountDownLatch(1);
		CountDownLatch release = new CountDownLatch(1);
		Thread a = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> {
			loaded.add("1");
			inFirst.countDown();
			await(release);
		}));
		a.start();
		inFirst.await();
		Thread b = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> loaded.add("2")));
		Thread c = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> loaded.add("3")));
		b.start();
		Thread.sleep(50);
		c.start();
		Thread.sleep(50);
		release.countDown();
		a.join();
		b.join();
		c.join();
		assertEquals(Arrays.asList("1", "3"), loaded);
	}

	private static void await(CountDownLatch latch) {
		try {
			latch.await();
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}

	@Test
	public void theVisibleSourceFollowsTheBrowser() {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK));
		browser.select("tab1");
		assertEquals(ImagerySource.ESRI_WAYBACK, imagery.visibleSource());
		imagery.show(ImagerySource.GOOGLE_EARTH_WEB);
		assertTrue(browser.calls.contains("activate tab0"));
	}
}
