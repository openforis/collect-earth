package org.openforis.collect.earth.app.view;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

class MessagesBundleTest {

	private static final String FOLDER = "/org/openforis/collect/earth/app/view/";

	private static final String[] BUNDLES = { "Messages", "Messages_es", "Messages_fr", "Messages_pt", "Messages_tr" };

	/** Section.name keys */
	private static final Pattern KEY = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_-]+)+");

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

	// Every language the interface offers is complete: a missing text shows in English in the middle of the page
	@Test
	void everyTranslationHasEveryEnglishText() throws IOException {
		Properties english = load("Messages");
		for (int i = 1; i < BUNDLES.length; i++) {
			Properties translation = load(BUNDLES[i]);
			List<String> missing = new ArrayList<>();
			for (String key : english.stringPropertyNames()) {
				if (!translation.containsKey(key)) {
					missing.add(key);
				}
			}
			assertTrue(missing.isEmpty(), BUNDLES[i] + " lacks " + missing);
		}
	}

	// ResourceBundle reads a file as UTF-8 and only falls back to ISO-8859-1 when the whole file is not UTF-8, so one
	// Latin-1 letter in a UTF-8 file (or the other way round) turns every accented letter of that language into garbage
	@Test
	void everyBundleIsUtf8() throws IOException {
		for (String bundle : BUNDLES) {
			try (InputStream in = open(bundle)) {
				byte[] bytes = in.readAllBytes();
				try {
					StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes));
				} catch (CharacterCodingException e) {
					throw new AssertionError(bundle + ".properties is not UTF-8: write the letter as \\uXXXX or save the file as UTF-8", e);
				}
			}
		}
	}

	// OptionWizard.1043-1045 were once given to the Planet texts as well, so the Swing settings showed the Planet API key
	// note on their Apply button. Those keys went with that dialog; the Planet notes the settings page shows stay their own
	@Test
	void thePlanetNotesHaveTheirOwnTexts() throws IOException {
		Properties english = load("Messages");
		for (String planetKey : new String[] { "OptionWizard.1053" }) {
			assertTrue(english.getProperty(planetKey).contains("API key") || english.getProperty(planetKey).contains("own key"), planetKey);
		}
		Properties spanish = load("Messages_es");
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
