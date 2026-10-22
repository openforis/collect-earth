package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.EnumSet;

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
}
