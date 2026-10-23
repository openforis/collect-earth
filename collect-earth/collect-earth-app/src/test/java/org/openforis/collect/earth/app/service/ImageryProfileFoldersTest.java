package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.EarthConstants;

/**
 * The Chrome and Edge profiles of the imagery window: one folder each, as a profile written by one of them is not one
 * the other can be relied on to read (its cookies are encrypted with a key of its own, and a newer version's profile
 * may be refused). Chrome takes over the profile of the old Google Earth Web window, which Chrome had first.
 */
public class ImageryProfileFoldersTest {

	@TempDir
	Path data;

	private File profiles() {
		return new File(data.toFile(), "browser_profiles");
	}

	private File oldGoogleEarthWeb() throws Exception {
		File old = new File(profiles(), "google_earth_web");
		Files.createDirectories(old.toPath());
		Files.write(new File(old, "Cookies").toPath(), "signed in".getBytes(StandardCharsets.UTF_8));
		return old;
	}

	@Test
	public void chromeAndEdgeHaveAFolderEach() throws Exception {
		File chrome = BrowserService.imageryChromiumProfile(data.toFile(), EarthConstants.CHROME_BROWSER);
		File edge = BrowserService.imageryChromiumProfile(data.toFile(), EarthConstants.EDGE_BROWSER);
		assertEquals(new File(profiles(), "imagery_chrome"), chrome);
		assertEquals(new File(profiles(), "imagery_edge"), edge);
		assertNotEquals(chrome, edge);
		assertTrue(chrome.isDirectory());
		assertTrue(edge.isDirectory());
	}

	@Test
	public void chromeTakesOverTheProfileOfTheGoogleEarthWebWindow() throws Exception {
		File old = oldGoogleEarthWeb();
		File chrome = BrowserService.imageryChromiumProfile(data.toFile(), EarthConstants.CHROME_BROWSER);
		assertFalse(old.exists());
		assertEquals("signed in", new String(Files.readAllBytes(new File(chrome, "Cookies").toPath()), StandardCharsets.UTF_8));
	}

	@Test
	public void edgeLeavesTheProfileOfTheGoogleEarthWebWindowToChrome() throws Exception {
		File old = oldGoogleEarthWeb();
		File edge = BrowserService.imageryChromiumProfile(data.toFile(), EarthConstants.EDGE_BROWSER);
		assertTrue(old.isDirectory());
		assertFalse(new File(edge, "Cookies").exists());
		File chrome = BrowserService.imageryChromiumProfile(data.toFile(), EarthConstants.CHROME_BROWSER);
		assertTrue(new File(chrome, "Cookies").exists());
	}

	@Test
	public void aChromeProfileThereAlreadyIsKept() throws Exception {
		File chrome = BrowserService.imageryChromiumProfile(data.toFile(), EarthConstants.CHROME_BROWSER);
		File old = oldGoogleEarthWeb();
		assertEquals(chrome, BrowserService.imageryChromiumProfile(data.toFile(), EarthConstants.CHROME_BROWSER));
		assertTrue(old.isDirectory());
		assertFalse(new File(chrome, "Cookies").exists());
	}

	@Test
	public void anOldProfileThatCannotBeRenamedGivesATemporaryProfileUntilItCan() throws Exception {
		// A folder with a file open in it cannot be renamed on Windows (as when a browser has the profile open)
		assumeTrue(System.getProperty("os.name", "").startsWith("Windows"));
		File old = oldGoogleEarthWeb();
		try (FileOutputStream open = new FileOutputStream(new File(old, "Cookies"), true)) {
			assertNull(BrowserService.imageryChromiumProfile(data.toFile(), EarthConstants.CHROME_BROWSER));
			// Not created under the new name, which would stop the rename from being tried again
			assertFalse(new File(profiles(), "imagery_chrome").exists());
		}
		File chrome = BrowserService.imageryChromiumProfile(data.toFile(), EarthConstants.CHROME_BROWSER);
		assertTrue(new File(chrome, "Cookies").exists());
	}
}
