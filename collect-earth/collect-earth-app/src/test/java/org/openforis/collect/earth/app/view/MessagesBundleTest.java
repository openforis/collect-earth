package org.openforis.collect.earth.app.view;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

class MessagesBundleTest {

	private static final String FOLDER = "/org/openforis/collect/earth/app/view/";

	// Messages_mn.properties is left out: its translations run into each other (16 keys are fragments of other
	// lines, e.g. line 98 "</ HTML> OptionWizard.20 = ..."), so OptionWizard.20, .37 and .95 are lost in Mongolian.
	// Repairing it needs a Mongolian speaker.
	private static final String[] BUNDLES = { "Messages", "Messages_es", "Messages_fr", "Messages_hi", "Messages_lo",
			"Messages_pt", "Messages_tr", "Messages_vi" };

	/** Section.name keys, plus the few button keys of the confirmation dialogs */
	private static final Pattern KEY = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_-]+)+|YES|NO|YES_TO_ALL|NO_TO_ALL");

	// A line break typed into a translation instead of \n ends the value there, and the rest of the text becomes a
	// key of its own ("Look for fields..." became the key "Look")
	@Test
	void everyKeyIsAKeyAndNotTheRestOfASentence() throws IOException {
		List<String> notKeys = new ArrayList<>();
		for (String bundle : BUNDLES) {
			for (String key : load(bundle).stringPropertyNames()) {
				if (!KEY.matcher(key).matches()) {
					notKeys.add(bundle + ": " + key);
				}
			}
		}
		assertTrue(notKeys.isEmpty(), "Keys that are the rest of a value broken by a line break : " + notKeys);
	}

	// OptionWizard.1043-1045 were given to the Planet texts as well, so applying the settings showed the Planet API key
	// note on the button and in the confirmation
	@Test
	void theOptionsDialogAndThePlanetNoteHaveTheirOwnTexts() throws IOException {
		Properties english = load("Messages");
		assertEquals("Applying Changes...", english.getProperty("OptionWizard.1043"));
		assertEquals("Settings have been applied successfully.", english.getProperty("OptionWizard.1044"));
		assertEquals("The application will restart to apply some changes.", english.getProperty("OptionWizard.1045"));
		assertEquals("Please correct the validation errors before applying changes.\n\n"
				+ "Look for fields highlighted in red and check their tooltips for guidance.", english.getProperty("OptionWizard.1047"));
		for (String planetKey : new String[] { "OptionWizard.1053", "OptionWizard.1054", "OptionWizard.1055" }) {
			assertTrue(english.getProperty(planetKey).contains("API key") || english.getProperty(planetKey).contains("own key"), planetKey);
		}

		Properties spanish = load("Messages_es");
		assertEquals("Aplicando cambios...", spanish.getProperty("OptionWizard.1043"));
		assertTrue(spanish.getProperty("OptionWizard.1047").contains("\n\nBusque los campos"));
		assertTrue(spanish.getProperty("OptionWizard.1053").contains("planet.com"));
	}

	private static Properties load(String bundle) throws IOException {
		Properties properties = new Properties();
		try (InputStream in = open(bundle)) {
			properties.load(in);
		}
		return properties;
	}

	private static InputStream open(String bundle) {
		InputStream in = MessagesBundleTest.class.getResourceAsStream(FOLDER + bundle + ".properties");
		assertNotNull(in, bundle + ".properties not found on the classpath");
		return in;
	}
}
