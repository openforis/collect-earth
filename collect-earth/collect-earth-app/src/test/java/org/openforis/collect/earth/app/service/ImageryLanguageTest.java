package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;

public class ImageryLanguageTest {

	@Test
	public void theImageryWindowAsksForCollectEarthsLanguageThenEnglish() {
		assertEquals("es,en", BrowserService.acceptLanguages(UI_LANGUAGE.ES));
		assertEquals("pt,en", BrowserService.acceptLanguages(UI_LANGUAGE.PT));
		assertEquals("en", BrowserService.acceptLanguages(UI_LANGUAGE.EN));
		assertEquals("en", BrowserService.acceptLanguages(null));
	}

	@Test
	public void theImageryFirefoxKeepsItsMemoryWithinBounds() {
		String prefs = BrowserService.imageryFirefoxMemoryPrefs();
		for (String line : prefs.split("\n")) {
			assertTrue(line.matches("user_pref\\(\"[a-zA-Z_.]+\", (-?\\d+|true|false)\\);"), line);
		}
		assertTrue(prefs.contains("user_pref(\"browser.sessionhistory.max_total_viewers\", 0);"), prefs);
		assertTrue(prefs.contains("user_pref(\"browser.sessionhistory.max_entries\", 10);"), prefs);
		assertTrue(prefs.contains("user_pref(\"dom.ipc.processPrelaunch.fission.number\", 1);"), prefs);
		assertTrue(prefs.contains("user_pref(\"browser.newtab.preload\", false);"), prefs);
		// Not the process count: see imageryFirefoxMemoryPrefs
		assertFalse(prefs.contains("dom.ipc.processCount"), prefs);
	}
}
