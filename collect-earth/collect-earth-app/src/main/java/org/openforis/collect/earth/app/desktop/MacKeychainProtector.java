package org.openforis.collect.earth.app.desktop;

import java.io.IOException;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.service.SecretProtector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The cloud tokens kept in the user's macOS Keychain (login keychain), not in earth.properties: the file only says
 * {@code keychain:cloud_sync_token}, so a copy of it carries no token (recommendation 1 of the data review). There is one
 * item per server, its account the property's name ({@code cloud_sync_token <server>}); {@code cloud_sync_token} alone is
 * the single token of the versions before. Apple's own {@code security} command does the work, so nothing is installed;
 * the token is given to it on its standard input ({@code security -i}), never as an argument, which other programs of
 * the computer could read in the process list. Read once, then kept in memory: the sync reads the token every 30 seconds.
 */
public final class MacKeychainProtector implements SecretProtector {

	private static final Logger logger = LoggerFactory.getLogger(MacKeychainProtector.class);
	static final String PREFIX = "keychain:";
	static final String SERVICE = "Collect Earth cloud token";
	static final String ACCOUNT = "cloud_sync_token";
	private static final String SECURITY = "/usr/bin/security";
	/** What a token is made of (base64url and the like): anything else is not passed to the command line of security -i */
	private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9._~+/=-]{1,4096}");
	/** An account: the property's name, a server's address after it; no quote, backslash or line break for security -i */
	private static final Pattern ACCOUNT_NAME = Pattern.compile("cloud_sync_token( [^\\s\"\\\\]{1,1024})?");
	/** security's exit code when the item is not in the keychain */
	static final int NOT_FOUND = 44;

	private final SecretCommand.Runner runner;
	private final Map<String, String> cached = new ConcurrentHashMap<>();

	MacKeychainProtector(SecretCommand.Runner runner) {
		this.runner = runner;
	}

	/** The protector on macOS, or null elsewhere or without Apple's security command (the token then stays in the file). */
	public static SecretProtector ifAvailable() {
		if (!SystemUtils.IS_OS_MAC || !new java.io.File(SECURITY).canExecute()) {
			return null;
		}
		return new MacKeychainProtector(SecretCommand::run);
	}

	@Override
	public String prefix() {
		return PREFIX;
	}

	@Override
	public String protect(String plain) {
		return protect(ACCOUNT, plain);
	}

	@Override
	public String protect(String account, String plain) {
		if (!TOKEN.matcher(plain).matches() || !ACCOUNT_NAME.matcher(account).matches()) {
			throw new IllegalArgumentException("not a token the keychain is given");
		}
		try {
			// -U: replaces the one there; the label is what Keychain Access shows
			String command = "add-generic-password -U -a \"" + account + "\" -s \"" + SERVICE + "\" -l \"Collect Earth\" -w \"" + plain + "\"\n";
			runner.run(Arrays.asList(SECURITY, "-i"), command);
			// security -i says nothing of a failure in its exit code: what is there is read back
			cached.remove(account);
			if (!plain.equals(read(account))) {
				throw new IllegalStateException("the keychain did not keep the token");
			}
			cached.put(account, plain);
			return PREFIX + account;
		} catch (IOException e) {
			throw new IllegalStateException("security could not be run: " + e.getMessage(), e);
		}
	}

	@Override
	public String reveal(String stored) {
		return reveal(ACCOUNT, stored);
	}

	@Override
	public String reveal(String account, String stored) {
		String known = cached.get(account);
		if (known != null) {
			return known.isEmpty() ? null : known;
		}
		try {
			String token = read(account);
			if (token == null) {
				logger.info("The cloud token is not in this user's keychain (a settings file from elsewhere?): the login is asked for again");
				// "" for none, so the sync's reads every 30 s do not each run the command again (protect and forget clear it)
				cached.put(account, "");
				return null;
			}
			cached.put(account, token);
			return token;
		} catch (IOException e) {
			cached.put(account, "");
			logger.warn("The keychain could not be read: {}", e.getMessage());
			return null;
		}
	}

	@Override
	public void forget() {
		forget(ACCOUNT);
	}

	@Override
	public void forget(String account) {
		cached.remove(account);
		try {
			runner.run(Arrays.asList(SECURITY, "delete-generic-password", "-a", account, "-s", SERVICE), "");
		} catch (IOException e) {
			logger.debug("The token could not be removed from the keychain: {}", e.getMessage());
		}
	}

	/** The token in the keychain, or null when there is none. */
	private String read(String account) throws IOException {
		SecretCommand.Result result = runner.run(Arrays.asList(SECURITY, "find-generic-password", "-a", account, "-s", SERVICE, "-w"), "");
		if (result.exit != 0) {
			if (result.exit != NOT_FOUND) {
				logger.warn("security find-generic-password ended with {}", result.exit);
			}
			return null;
		}
		String token = result.output.trim();
		return token.isEmpty() ? null : token;
	}
}
