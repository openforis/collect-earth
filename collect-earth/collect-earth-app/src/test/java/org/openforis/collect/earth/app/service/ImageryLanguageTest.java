package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
}
