package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Collections;
import java.util.Properties;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

/** The cloud token kept with the operating system's protection (SecretProtector), never in plain text once it can be. */
class LocalPropertiesSecretTest {

	/** Stands for Windows' DPAPI: reversible here, and readable only by "this computer" */
	static final class FakeProtector implements SecretProtector {
		boolean thisComputer = true;

		@Override
		public String prefix() {
			return "fake:";
		}

		@Override
		public String protect(String plain) {
			return "fake:" + new StringBuilder(plain).reverse();
		}

		@Override
		public String reveal(String stored) {
			return thisComputer ? new StringBuilder(stored.substring(5)).reverse().toString() : null;
		}

		int forgotten;

		@Override
		public void forget() {
			forgotten++;
		}
	}

	@AfterEach
	void noProtector() {
		LocalPropertiesService.setSecretProtector(null);
	}

	@Test
	void theTokenIsWrittenProtectedAndReadPlain() {
		FakeProtector protector = new FakeProtector();
		LocalPropertiesService.setSecretProtector(protector);
		Properties file = new Properties();
		LocalPropertiesService service = new LocalPropertiesService(file);
		service.saveCloudSyncToken("secret-token");
		assertEquals("fake:nekot-terces", file.getProperty("cloud_sync_token"));
		assertEquals("secret-token", service.getCloudSyncToken());
		// The settings page saves it with the rest
		service.setValues(Collections.singletonMap("cloud_sync_token", "other"));
		assertEquals("fake:rehto", file.getProperty("cloud_sync_token"));
		assertEquals("other", service.getValue(EarthProperty.CLOUD_SYNC_TOKEN));
		// Other values stay as they are
		service.setValue(EarthProperty.OPERATOR_KEY, "anna");
		assertEquals("anna", file.getProperty(EarthProperty.OPERATOR_KEY.toString()));
	}

	@Test
	void aTokenFromBeforeIsProtectedAtStartAndOneFromElsewhereIsNoToken() {
		Properties file = new Properties();
		file.setProperty("cloud_sync_token", "plain-token");
		LocalPropertiesService service = new LocalPropertiesService(file);
		// No protector (not Windows): as before
		service.protectSecrets();
		assertEquals("plain-token", file.getProperty("cloud_sync_token"));
		FakeProtector protector = new FakeProtector();
		LocalPropertiesService.setSecretProtector(protector);
		assertEquals("plain-token", service.getCloudSyncToken());
		service.protectSecrets();
		assertTrue(file.getProperty("cloud_sync_token").startsWith("fake:"));
		assertEquals("plain-token", service.getCloudSyncToken());
		// The file copied to another computer: no token, so the login is asked for again
		protector.thisComputer = false;
		assertEquals("", service.getCloudSyncToken());
		// An empty token stays empty, and the protector forgets what it kept
		service.saveCloudSyncToken("");
		assertEquals("", file.getProperty("cloud_sync_token"));
		assertEquals(1, protector.forgotten);
	}

	@Test
	void aReferenceOfAnotherProtectorIsNoToken() {
		Properties file = new Properties();
		file.setProperty("cloud_sync_token", "keyring:cloud_sync_token");
		LocalPropertiesService service = new LocalPropertiesService(file);
		// no protector (a Linux without its keyring now): not sent as the token, the login is asked for
		assertEquals("", service.getCloudSyncToken());
		// another protector: neither revealed nor protected as if it were the token
		LocalPropertiesService.setSecretProtector(new FakeProtector());
		assertEquals("", service.getCloudSyncToken());
		service.protectSecrets();
		assertEquals("keyring:cloud_sync_token", file.getProperty("cloud_sync_token"));
	}

	@Test
	void theSettingsFileIsTheOwnersOnlyOnLinuxAndMacOs(@org.junit.jupiter.api.io.TempDir java.nio.file.Path folder) throws Exception {
		java.nio.file.Path file = folder.resolve("earth.properties");
		java.nio.file.Files.write(file, "cloud_sync_token=x\n".getBytes());
		if (!file.getFileSystem().supportedFileAttributeViews().contains("posix")) {
			assertEquals(false, LocalPropertiesService.ownerOnly(file));
			return;
		}
		java.nio.file.Files.setPosixFilePermissions(file, java.nio.file.attribute.PosixFilePermissions.fromString("rw-r--r--"));
		assertTrue(LocalPropertiesService.ownerOnly(file));
		assertEquals("rw-------", java.nio.file.attribute.PosixFilePermissions.toString(java.nio.file.Files.getPosixFilePermissions(file)));
		assertEquals(false, LocalPropertiesService.ownerOnly(folder.resolve("missing.properties")));
	}

	/** A protector the system refuses (a locked keychain, no secret-tool): it fails, the token is still kept */
	static final class RefusingProtector implements SecretProtector {
		@Override
		public String prefix() {
			return "locked:";
		}

		@Override
		public String protect(String plain) {
			throw new IllegalStateException("the keychain is locked");
		}

		@Override
		public String reveal(String stored) {
			return null;
		}

		@Override
		public void forget() {
			throw new IllegalStateException("the keychain is locked");
		}
	}

	@Test
	void aTokenTheSystemCannotProtectIsKeptAsItIs() {
		LocalPropertiesService.setSecretProtector(new RefusingProtector());
		Properties file = new Properties();
		LocalPropertiesService service = new LocalPropertiesService(file);
		service.saveCloudSyncToken("secret-token");
		assertEquals("secret-token", file.getProperty("cloud_sync_token"));
		assertEquals("secret-token", service.getCloudSyncToken());
		// at start, a plain token it cannot protect stays plain, and the file is not written again
		service.protectSecrets();
		assertEquals("secret-token", file.getProperty("cloud_sync_token"));
		// signing out empties it, though the system cannot forget its copy
		service.saveCloudSyncToken("");
		assertEquals("", file.getProperty("cloud_sync_token"));
	}

	@Test
	void signingOutForgetsTheSystemsCopyAndAProtectedTokenIsLeftAsItIs() {
		FakeProtector protector = new FakeProtector();
		LocalPropertiesService.setSecretProtector(protector);
		Properties file = new Properties();
		LocalPropertiesService service = new LocalPropertiesService(file);
		service.saveCloudSyncToken("secret-token");
		String written = file.getProperty("cloud_sync_token");
		// already protected: protectSecrets leaves it
		service.protectSecrets();
		assertEquals(written, file.getProperty("cloud_sync_token"));
		service.saveCloudSyncToken("");
		assertEquals(1, protector.forgotten);
		assertEquals("", service.getCloudSyncToken());
	}

	@Test
	void theSettingsOfPlanetTheViewerAndThePointNumbers() {
		Properties file = new Properties();
		LocalPropertiesService service = new LocalPropertiesService(file);
		// Planet: offered once its key is set
		assertEquals(false, service.isPlanetMapsSupported());
		service.setValue(EarthProperty.PLANET_MAPS_KEY, "  ");
		assertEquals(false, service.isPlanetMapsSupported());
		service.setValue(EarthProperty.PLANET_MAPS_KEY, "PLAK123");
		assertEquals(true, service.isPlanetMapsSupported());
		// the sample points numbered: a project that answers per point asks for it
		assertEquals(false, service.isSamplePointNumbers());
		service.setValue(EarthProperty.SAMPLE_POINT_NUMBERS, "true");
		assertEquals(true, service.isSamplePointNumbers());
	}
}
