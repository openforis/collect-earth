package org.openforis.collect.earth.app.view;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

/**
 * Every key the sources ask for is in Messages.properties: the Java (Messages.getString, the keys of SettingsModel and
 * the notices) and the pages (the texts of the server they show). A key missing shows as !key! in Java and as the key
 * itself on a page. The keys of the Swing UI were pruned once nothing asked for them; this keeps the other direction.
 * <p>
 * A key is a string literal that starts with the section of a key of the bundle and a dot ("CollectEarthWindow.14");
 * a literal ending with a dot is a prefix completed at run time ("SettingsPage.shape." + shape) and is not checked.
 */
class MessageKeysAskedForTest {

	private static final Pattern LITERAL = Pattern.compile("\"((?:\\\\.|[^\"\\\\\\n])*)\"");
	private static final Pattern KEY = Pattern.compile("([A-Z][A-Za-z0-9_]*)(\\.[A-Za-z0-9_-]+)+");

	@Test
	void everyKeyAskedForIsInTheBundle() throws IOException {
		Properties bundle = new Properties();
		try (InputStream in = MessageKeysAskedForTest.class.getResourceAsStream("/org/openforis/collect/earth/app/view/Messages.properties")) {
			bundle.load(in);
		}
		Set<String> sections = new HashSet<>();
		for (String key : bundle.stringPropertyNames()) {
			sections.add(key.substring(0, key.indexOf('.') < 0 ? key.length() : key.indexOf('.')));
		}
		// The tests run in the folder of the module
		Path java = Paths.get("src/main/java");
		Path pages = Paths.get("src/main/frontend/src");
		assumeTrue(Files.isDirectory(java), "The sources are not here");

		Set<String> missing = new TreeSet<>();
		for (Path file : sources(java, ".java")) {
			missing.addAll(missingIn(file, bundle, sections));
		}
		if (Files.isDirectory(pages)) {
			for (Path file : sources(pages, ".ts", ".tsx")) {
				missing.addAll(missingIn(file, bundle, sections));
			}
		}
		assertTrue(missing.isEmpty(), "Keys asked for but not in Messages.properties: " + missing);
	}

	private static List<Path> sources(Path folder, String... extensions) throws IOException {
		try (Stream<Path> walk = Files.walk(folder)) {
			return walk.filter(p -> {
				String name = p.getFileName().toString();
				return !name.contains(".test.") && Stream.of(extensions).anyMatch(name::endsWith);
			}).collect(Collectors.toList());
		}
	}

	private static Set<String> missingIn(Path file, Properties bundle, Set<String> sections) throws IOException {
		Set<String> missing = new TreeSet<>();
		String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
		Matcher literal = LITERAL.matcher(text);
		while (literal.find()) {
			String value = literal.group(1);
			Matcher key = KEY.matcher(value);
			if (key.matches() && sections.contains(key.group(1)) && bundle.getProperty(value) == null) {
				missing.add(value + " (" + file.getFileName() + ")");
			}
		}
		return missing;
	}
}
