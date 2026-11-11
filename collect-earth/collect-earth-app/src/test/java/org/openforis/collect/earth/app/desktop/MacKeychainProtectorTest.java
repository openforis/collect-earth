package org.openforis.collect.earth.app.desktop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

/** The cloud token in the macOS Keychain, with a stand-in for Apple's security command. */
public class MacKeychainProtectorTest {

	/** A keychain of one item, as security answers */
	static final class FakeSecurity implements SecretCommand.Runner {
		String item;
		final List<List<String>> commands = new ArrayList<>();
		final List<String> inputs = new ArrayList<>();
		int reads;

		@Override
		public SecretCommand.Result run(List<String> command, String input) {
			commands.add(command);
			inputs.add(input);
			String verb = command.get(1);
			if (verb.equals("-i")) {
				Matcher m = Pattern.compile("^add-generic-password -U .* -w \"([^\"]*)\"\\n$").matcher(input);
				if (m.matches()) item = m.group(1);
				return new SecretCommand.Result(0, "");
			}
			if (verb.equals("find-generic-password")) {
				reads++;
				return item == null ? new SecretCommand.Result(MacKeychainProtector.NOT_FOUND, "") : new SecretCommand.Result(0, item + "\n");
			}
			if (verb.equals("delete-generic-password")) {
				item = null;
				return new SecretCommand.Result(0, "");
			}
			return new SecretCommand.Result(1, "");
		}
	}

	@Test
	public void theTokenGoesToTheKeychainOnItsInputAndTheFileOnlyNamesIt() {
		FakeSecurity security = new FakeSecurity();
		MacKeychainProtector protector = new MacKeychainProtector(security);
		assertEquals("keychain:cloud_sync_token", protector.protect("Abc-123_xyz"));
		assertEquals("Abc-123_xyz", security.item);
		// Never an argument: other programs can read those in the process list
		for (List<String> command : security.commands) assertFalse(String.join(" ", command).contains("Abc-123_xyz"));
		assertEquals("Abc-123_xyz", protector.reveal("keychain:cloud_sync_token"));
		// Kept in memory: the sync reads it every 30 seconds
		int reads = security.reads;
		protector.reveal("keychain:cloud_sync_token");
		assertEquals(reads, security.reads);
	}

	/** A keychain of items by account, as security keeps them */
	static final class FakeKeychain implements SecretCommand.Runner {
		final java.util.Map<String, String> items = new java.util.HashMap<>();

		@Override
		public SecretCommand.Result run(List<String> command, String input) {
			if (command.get(1).equals("-i")) {
				Matcher m = Pattern.compile("^add-generic-password -U -a \"([^\"]*)\" .* -w \"([^\"]*)\"\\n$").matcher(input);
				if (m.matches()) items.put(m.group(1), m.group(2));
				return new SecretCommand.Result(0, "");
			}
			String account = command.get(command.indexOf("-a") + 1);
			if (command.get(1).equals("delete-generic-password")) {
				items.remove(account);
				return new SecretCommand.Result(0, "");
			}
			String item = items.get(account);
			return item == null ? new SecretCommand.Result(MacKeychainProtector.NOT_FOUND, "") : new SecretCommand.Result(0, item + "\n");
		}
	}

	@Test
	public void eachServersTokenIsAnItemOfItsOwn() {
		FakeKeychain keychain = new FakeKeychain();
		MacKeychainProtector protector = new MacKeychainProtector(keychain);
		assertEquals("keychain:cloud_sync_token https://a.org", protector.protect("cloud_sync_token https://a.org", "tok-a"));
		assertEquals("keychain:cloud_sync_token https://b.org:8443/ce", protector.protect("cloud_sync_token https://b.org:8443/ce", "tok-b"));
		protector.protect("before");
		MacKeychainProtector restarted = new MacKeychainProtector(keychain);
		assertEquals("tok-a", restarted.reveal("cloud_sync_token https://a.org", "keychain:cloud_sync_token https://a.org"));
		assertEquals("tok-b", restarted.reveal("cloud_sync_token https://b.org:8443/ce", "keychain:cloud_sync_token https://b.org:8443/ce"));
		assertEquals("before", restarted.reveal("keychain:cloud_sync_token"));
		// Signing out of one server leaves the others
		restarted.forget("cloud_sync_token https://a.org");
		assertNull(restarted.reveal("cloud_sync_token https://a.org", "keychain:cloud_sync_token https://a.org"));
		assertEquals("tok-b", new MacKeychainProtector(keychain).reveal("cloud_sync_token https://b.org:8443/ce", ""));
		// An account security -i would read otherwise is never given to it
		assertThrows(IllegalArgumentException.class, () -> protector.protect("cloud_sync_token https://x\" -s \"y", "tok"));
	}

	@Test
	public void aFileFromElsewhereIsNoTokenAndSigningOutRemovesIt() {
		FakeSecurity security = new FakeSecurity();
		assertNull(new MacKeychainProtector(security).reveal("keychain:cloud_sync_token"));
		MacKeychainProtector protector = new MacKeychainProtector(security);
		protector.protect("tok");
		protector.forget();
		assertNull(security.item);
		assertNull(protector.reveal("keychain:cloud_sync_token"));
	}

	@Test
	public void whatIsNotATokenIsNotPassedAndAKeychainThatDidNotKeepItIsAFailure() {
		FakeSecurity security = new FakeSecurity();
		MacKeychainProtector protector = new MacKeychainProtector(security);
		assertThrows(IllegalArgumentException.class, () -> protector.protect("a\" ; delete-keychain \"x"));
		assertTrue(security.commands.isEmpty());
		MacKeychainProtector forgetful = new MacKeychainProtector((command, input) -> new SecretCommand.Result(command.get(1).equals("find-generic-password") ? 44 : 0, ""));
		assertThrows(IllegalStateException.class, () -> forgetful.protect("tok"));
	}
}
