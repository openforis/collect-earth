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
		// An empty token stays empty
		service.saveCloudSyncToken("");
		assertEquals("", file.getProperty("cloud_sync_token"));
	}
}
