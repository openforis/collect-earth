package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Properties;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;

/** Several cloud projects, each bound to its folder, and one sign-in per server. */
class LocalPropertiesCloudProjectsTest {

	/** A keychain: one item per key, the file naming it */
	static final class KeyedProtector implements SecretProtector {
		final java.util.Map<String, String> items = new java.util.HashMap<>();
		final List<String> forgotten = new ArrayList<>();

		@Override
		public String prefix() {
			return "kc:";
		}

		@Override
		public String protect(String plain) {
			throw new AssertionError("the key is always given");
		}

		@Override
		public String reveal(String stored) {
			throw new AssertionError("the key is always given");
		}

		@Override
		public String protect(String key, String plain) {
			items.put(key, plain);
			return "kc:" + key;
		}

		@Override
		public String reveal(String key, String stored) {
			return items.get(key);
		}

		@Override
		public void forget(String key) {
			forgotten.add(key);
			items.remove(key);
		}
	}

	@AfterEach
	void noProtector() {
		LocalPropertiesService.setSecretProtector(null);
	}

	private static final File KENYA = new File("projects/kenya").getAbsoluteFile();
	private static final File PERU = new File("projects/peru").getAbsoluteFile();

	private static Properties singleSlot() {
		Properties file = new Properties();
		file.setProperty("cloud_sync_url", "https://a.org/");
		file.setProperty("cloud_project_id", "p1");
		file.setProperty("cloud_project_folder", KENYA.getPath());
		file.setProperty("cloud_sync_token", "token-a");
		file.setProperty("operator", "ana");
		file.setProperty("db_driver", "CLOUD");
		file.setProperty("metadata_file", new File(KENYA, "placemark.idm.xml").getPath());
		return file;
	}

	@Test
	void theSingleCloudProjectOfBeforeBecomesTheFirstBindingWithItsToken() {
		KeyedProtector keychain = new KeyedProtector();
		LocalPropertiesService.setSecretProtector(keychain);
		Properties file = singleSlot();
		LocalPropertiesService service = new LocalPropertiesService(file);
		service.migrateCloudSettings();

		CloudBinding kenya = service.getCloudBinding(KENYA);
		assertEquals("https://a.org", kenya.server);
		assertEquals("p1", kenya.projectId);
		assertEquals("ana", kenya.username);
		assertNull(kenya.projectName);
		assertEquals("token-a", keychain.items.get("cloud_sync_token https://a.org"));
		assertEquals("token-a", service.getCloudSyncToken());
		assertEquals(Collections.singletonMap("https://a.org", "ana"), service.getCloudAccounts());
		// The keys of before stay as they were (a fallback, and for an older version)
		assertEquals("https://a.org/", file.getProperty("cloud_sync_url"));
		assertEquals("token-a", file.getProperty("cloud_sync_token"));

		// Once: a binding removed later is not brought back
		service.saveCloudBinding(new CloudBinding(KENYA.getPath(), "https://a.org", "p9", null, "ana"));
		service.migrateCloudSettings();
		assertEquals("p9", service.getCloudBinding(KENYA).projectId);
		assertEquals(1, service.getCloudBindings().size());
	}

	@Test
	void joinedBeforeTheFolderWasKeptTheProjectOpenInCloudModeIsTheCloudOne() {
		Properties file = singleSlot();
		file.remove("cloud_project_folder");
		LocalPropertiesService service = new LocalPropertiesService(file);
		service.migrateCloudSettings();
		assertEquals("p1", service.getCloudBinding(KENYA).projectId);
	}

	@Test
	void nothingToMoveIsNoBinding() {
		LocalPropertiesService service = new LocalPropertiesService(new Properties());
		service.migrateCloudSettings();
		assertTrue(service.getCloudBindings().isEmpty());
		assertNull(service.getCloudBinding());
		assertTrue(service.getCloudAccounts().isEmpty());
	}

	@Test
	void eachServerHasItsTokenAndTheTokenOfBeforeIsItsServersFallback() {
		Properties file = singleSlot();
		LocalPropertiesService service = new LocalPropertiesService(file);
		// Not migrated: the token of before still answers for its server, and only for it
		assertEquals("token-a", service.getCloudToken("https://a.org"));
		assertEquals("", service.getCloudToken("https://b.org"));
		service.saveCloudToken("https://b.org/", "bob", "token-b");
		assertEquals("token-b", service.getCloudToken("https://b.org"));
		assertEquals("token-a", service.getCloudToken("https://a.org"));
		service.saveCloudToken("https://a.org", "ana", "token-a2");
		assertEquals("token-a2", service.getCloudToken("https://a.org"));
		assertEquals("token-b", service.getCloudToken("https://b.org"));
	}

	@Test
	void signingOutForgetsThatServersTokenOnlyAndKeepsTheBindings() {
		KeyedProtector keychain = new KeyedProtector();
		LocalPropertiesService.setSecretProtector(keychain);
		Properties file = singleSlot();
		LocalPropertiesService service = new LocalPropertiesService(file);
		service.migrateCloudSettings();
		service.saveCloudBinding(new CloudBinding(PERU.getPath(), "https://b.org", "p2", "Peru", "bob"));
		service.saveCloudToken("https://b.org", "bob", "token-b");

		service.saveCloudToken("https://a.org/", null, "");
		assertEquals("", service.getCloudToken("https://a.org"));
		// The keychain's item goes, and the token of before too: it would have answered for this server
		assertTrue(keychain.forgotten.contains("cloud_sync_token https://a.org"));
		assertTrue(keychain.forgotten.contains("cloud_sync_token"));
		assertEquals("", file.getProperty("cloud_sync_token"));
		assertFalse(file.containsKey("cloud_sync_token https://a.org"));
		assertEquals("token-b", service.getCloudToken("https://b.org"));
		assertEquals(Collections.singletonMap("https://b.org", "bob"), service.getCloudAccounts());
		// The project stays a cloud project, waiting for the sign-in
		assertEquals("p1", service.getCloudBinding(KENYA).projectId);
		assertEquals("", service.getCloudSyncToken());

		// Signing in again as someone else names them the account of the server's projects
		service.saveCloudToken("https://a.org", "carla", "token-c");
		assertEquals("carla", service.getCloudBinding(KENYA).username);
		assertEquals("bob", service.getCloudBinding(PERU).username);
		assertEquals("token-c", service.getCloudSyncToken());
	}

	@Test
	void bindingAFolderLeavesTheOtherProjectsBindingsAndAJoinAgainMovesItsOwn() {
		LocalPropertiesService service = new LocalPropertiesService(new Properties());
		service.saveCloudBinding(new CloudBinding(KENYA.getPath(), "https://a.org", "p1", "Kenya", "ana"));
		service.saveCloudBinding(new CloudBinding(PERU.getPath(), "https://a.org", "p2", "Peru", "ana"));
		assertEquals(2, service.getCloudBindings().size());
		// The same cloud project joined again with a new link: its binding is updated, not doubled
		service.saveCloudBinding(new CloudBinding(PERU.getPath(), "https://new.a.org", "p2", "Peru", "ana"));
		assertEquals(2, service.getCloudBindings().size());
		assertEquals("https://new.a.org", service.getCloudBinding(PERU).server);
		assertEquals("p1", service.getCloudBinding(KENYA).projectId);
		// Another cloud project into a folder: that folder's binding is replaced, the other one kept
		service.saveCloudBinding(new CloudBinding(KENYA.getPath(), "https://a.org", "p3", "Kenya 2026", "ana"));
		assertEquals("p3", service.getCloudBinding(KENYA).projectId);
		assertEquals("p2", service.getCloudBinding(PERU).projectId);
	}

	@Test
	void theSettingsCloudFieldsAreTheOpenProjectsCloudProject() {
		Properties file = new Properties();
		file.setProperty("metadata_file", new File(PERU, "placemark.idm.xml").getPath());
		LocalPropertiesService service = new LocalPropertiesService(file);
		service.saveCloudBinding(new CloudBinding(PERU.getPath(), "https://b.org", "p2", "Peru", "bob"));
		service.saveCloudSyncToken("token-b");
		assertEquals("token-b", service.getCloudToken("https://b.org"));
		service.saveCloudProjectId("p7");
		assertEquals("p7", service.getCloudProjectId());
		assertFalse(file.containsKey("cloud_project_id"));
		assertEquals(CollectDBDriver.SQLITE, service.getCollectDBDriver());
	}
}
