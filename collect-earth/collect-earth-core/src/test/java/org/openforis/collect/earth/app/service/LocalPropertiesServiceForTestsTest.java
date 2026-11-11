package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.io.File;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

/**
 * The service the tests make with their own properties must never write the earth.properties of the user running them
 */
class LocalPropertiesServiceForTestsTest {

	@Test
	void aChangedValueStaysInMemory() {
		LocalPropertiesService service = new LocalPropertiesService(new Properties());
		// Checked first : were it persisted, the change below would overwrite the user's file
		assertFalse(service.isPersisted());

		File userProperties = new File(FolderFinder.getCollectEarthDataFolder(), "earth.properties");
		boolean existed = userProperties.exists();
		long modified = userProperties.lastModified();
		long length = userProperties.length();

		service.setValue(EarthProperty.OPERATOR_KEY, "anna");

		assertEquals("anna", service.getOperator());
		assertEquals(existed, userProperties.exists());
		assertEquals(modified, userProperties.lastModified());
		assertEquals(length, userProperties.length());
	}

	// Hindi, Lao, Mongolian, Vietnamese and Russian were dropped: a user who had chosen one starts in English
	@Test
	void aDroppedLanguageFallsBackToEnglish() {
		LocalPropertiesService service = new LocalPropertiesService(new Properties());
		for (String dropped : new String[] { "VI", "lo", "MN", "hi", "RU" }) {
			service.setValue(EarthProperty.UI_LANGUAGE, dropped);
			assertEquals(UI_LANGUAGE.EN, service.getUiLanguage(), dropped);
		}
		service.setValue(EarthProperty.UI_LANGUAGE, "tr");
		assertEquals(UI_LANGUAGE.TR, service.getUiLanguage());
	}
}
