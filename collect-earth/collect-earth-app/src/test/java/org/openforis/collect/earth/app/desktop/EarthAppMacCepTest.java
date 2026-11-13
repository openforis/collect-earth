package org.openforis.collect.earth.app.desktop;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

public class EarthAppMacCepTest {

	@TempDir
	File installFolder;

	private void infoPlist(String content) throws Exception {
		File plist = new File(installFolder, "CollectEarth-launcher.app/Contents/Info.plist");
		plist.getParentFile().mkdirs();
		Files.write(plist.toPath(), content.getBytes(StandardCharsets.UTF_8));
	}

	@Test
	public void noLauncherMeansCepFilesDoNotOpen() {
		assertFalse(EarthApp.macOpensCepFiles(installFolder));
	}

	@Test
	public void aLauncherWithoutTheDocumentTypeDoesNotOpenThem() throws Exception {
		infoPlist("<plist><dict><key>CFBundleIdentifier</key><string>vnd.openforis.collectearth</string></dict></plist>");
		assertFalse(EarthApp.macOpensCepFiles(installFolder));
	}

	@Test
	public void theDocumentTypeTheInstallerAddsOpensThem() throws Exception {
		infoPlist("<plist><dict><key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeExtensions</key>"
				+ "<array><string>cep</string></array></dict></array></dict></plist>");
		assertTrue(EarthApp.macOpensCepFiles(installFolder));
	}
}
