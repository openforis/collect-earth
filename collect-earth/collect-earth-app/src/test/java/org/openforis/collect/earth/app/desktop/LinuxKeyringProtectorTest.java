package org.openforis.collect.earth.app.desktop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.openforis.collect.earth.app.service.SecretProtector;

/**
 * The cloud token in the Linux desktop's keyring: with a stand-in for secret-tool, and, where a keyring answers (a
 * desktop session, or {@code dbus-run-session} with gnome-keyring-daemon unlocked), against the real one.
 */
public class LinuxKeyringProtectorTest {

	/** A keyring of one item, as secret-tool answers */
	static final class FakeSecretTool implements SecretCommand.Runner {
		String item;
		String unavailable;
		final List<List<String>> commands = new ArrayList<>();
		int lookups;

		@Override
		public SecretCommand.Result run(List<String> command, String input) {
			commands.add(command);
			if (unavailable != null) return new SecretCommand.Result(1, "", unavailable);
			switch (command.get(1)) {
			case "store":
				item = input;
				return new SecretCommand.Result(0, "");
			case "lookup":
				lookups++;
				return item == null ? new SecretCommand.Result(1, "") : new SecretCommand.Result(0, item);
			case "clear":
				item = null;
				return new SecretCommand.Result(0, "");
			default:
				return new SecretCommand.Result(2, "", "usage");
			}
		}
	}

	@Test
	public void theTokenGoesToTheKeyringOnItsInputAndTheFileOnlyNamesIt() {
		FakeSecretTool tool = new FakeSecretTool();
		LinuxKeyringProtector protector = new LinuxKeyringProtector(tool, "/usr/bin/secret-tool");
		assertTrue(protector.answers());
		assertEquals("keyring:cloud_sync_token", protector.protect("Abc-123_xyz"));
		assertEquals("Abc-123_xyz", tool.item);
		for (List<String> command : tool.commands) assertFalse(String.join(" ", command).contains("Abc-123_xyz"));
		assertEquals(List.of("/usr/bin/secret-tool", "store", "--label=Collect Earth cloud token", "service", "collect-earth", "account", "cloud_sync_token"), tool.commands.get(1));
		int lookups = tool.lookups;
		assertEquals("Abc-123_xyz", protector.reveal("keyring:cloud_sync_token"));
		assertEquals(lookups, tool.lookups);
		protector.forget();
		assertNull(tool.item);
		assertNull(protector.reveal("keyring:cloud_sync_token"));
	}

	@Test
	public void noKeyringInTheSessionIsNoProtector() {
		FakeSecretTool tool = new FakeSecretTool();
		tool.unavailable = "secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY";
		assertFalse(new LinuxKeyringProtector(tool, "secret-tool").answers());
		tool.unavailable = "secret-tool: Object does not exist at path “/org/freedesktop/secrets/collection/login”";
		assertFalse(new LinuxKeyringProtector(tool, "secret-tool").answers());
		assertThrows(IllegalStateException.class, () -> new LinuxKeyringProtector(tool, "secret-tool").protect("tok"));
		assertThrows(IllegalArgumentException.class, () -> new LinuxKeyringProtector(new FakeSecretTool(), "secret-tool").protect("a b"));
	}

	/** Run with a keyring: dbus-run-session, then gnome-keyring-daemon --unlock --components=secrets, then this test */
	@Test
	@EnabledIfEnvironmentVariable(named = "CE_KEYRING_TEST", matches = "true")
	public void theRealKeyring() {
		SecretProtector protector = LinuxKeyringProtector.ifAvailable();
		assertTrue(protector != null, "no keyring answers");
		String stored = protector.protect("real-token-123");
		assertEquals("keyring:cloud_sync_token", stored);
		// A fresh one, as after a restart: read from the keyring itself
		SecretProtector again = LinuxKeyringProtector.ifAvailable();
		assertEquals("real-token-123", again.reveal(stored));
		again.forget();
		assertNull(LinuxKeyringProtector.ifAvailable().reveal(stored));
	}
}
