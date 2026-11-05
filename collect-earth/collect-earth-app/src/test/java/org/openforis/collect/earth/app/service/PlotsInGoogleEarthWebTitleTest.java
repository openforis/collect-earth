package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * The title of Google Earth Web's page with the plots map in its panel: the survey's name first, so that a tab or a
 * task bar that cuts it still shows it, and always the mark by which its window gets the icon of Collect Earth
 * (BrowserWindowIcon looks for it anywhere in the title).
 */
class PlotsInGoogleEarthWebTitleTest {

	@Test
	void theSurveysNameComesFirst() {
		String title = BrowserService.plotsInGoogleEarthWebTitle(" Sierra Leone 2026 ");
		assertEquals("Sierra Leone 2026 · Google Earth Web · Collect Earth", title);
		assertTrue(title.contains(BrowserService.PLOTS_IN_GOOGLE_EARTH_WEB_TITLE));
	}

	@Test
	void withoutASurveyOnlyTheMark() {
		assertEquals(BrowserService.PLOTS_IN_GOOGLE_EARTH_WEB_TITLE, BrowserService.plotsInGoogleEarthWebTitle(null));
		assertEquals(BrowserService.PLOTS_IN_GOOGLE_EARTH_WEB_TITLE, BrowserService.plotsInGoogleEarthWebTitle("  "));
	}
}
