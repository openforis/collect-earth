package org.openforis.collect.earth.app.desktop;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.service.SecretProtector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The cloud token kept in the user's macOS Keychain (login keychain), not in earth.properties: the file only says
 * {@code keychain:cloud_sync_token}, so a copy of it carries no token (recommendation 1 of the data review). Apple's own
 * {@code security} command does the work, so nothing is installed; the token is given to it on its standard input
 * ({@code security -i}), never as an argument, which other programs of the computer could read in the process list.
 * Read once, then kept in memory: the sync reads the token every 30 seconds.
 */
public final class MacKeychainProtector implements SecretProtector {

	private static final Logger logger = LoggerFactory.getLogger(MacKeychainProtector.class);
	static final String PREFIX = "keychain:";
	static final String SERVICE = "Collect Earth cloud token";
	static final String ACCOUNT = "cloud_sync_token";
	private static final String SECURITY = "/usr/bin/security";
	/** What a token is made of (base64url and the like): anything else is not passed to the command line of security -i */
	private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9._~+/=-]{1,4096}");
	/** security's exit code when the item is not in the keychain */
	static final int NOT_FOUND = 44;

	/** Runs a command with what it reads on its standard input, and gives back its exit code and output. */
	interface Runner {
		Result run(List<String> command, String input) throws IOException;
	}

	static final class Result {
		final int exit;
		final String output;

		Result(int exit, String output) {
			this.exit = exit;
			this.output = output;
		}
	}

	private final Runner runner;
	private volatile String cached;

	MacKeychainProtector(Runner runner) {
		this.runner = runner;
	}

	/** The protector on macOS, or null elsewhere or without Apple's security command (the token then stays in the file). */
	public static SecretProtector ifAvailable() {
		if (!SystemUtils.IS_OS_MAC || !new java.io.File(SECURITY).canExecute()) {
			return null;
		}
		return new MacKeychainProtector(MacKeychainProtector::run);
	}

	@Override
	public String prefix() {
		return PREFIX;
	}

	@Override
	public String protect(String plain) {
		if (!TOKEN.matcher(plain).matches()) {
			throw new IllegalArgumentException("not a token the keychain is given");
		}
		try {
			// -U: replaces the one there; the label is what Keychain Access shows
			String command = "add-generic-password -U -a \"" + ACCOUNT + "\" -s \"" + SERVICE + "\" -l \"Collect Earth\" -w \"" + plain + "\"\n";
			runner.run(Arrays.asList(SECURITY, "-i"), command);
			// security -i says nothing of a failure in its exit code: what is there is read back
			cached = null;
			if (!plain.equals(read())) {
				throw new IllegalStateException("the keychain did not keep the token");
			}
			cached = plain;
			return PREFIX + ACCOUNT;
		} catch (IOException e) {
			throw new IllegalStateException("security could not be run: " + e.getMessage(), e);
		}
	}

	@Override
	public String reveal(String stored) {
		String known = cached;
		if (known != null) {
			return known;
		}
		try {
			String token = read();
			if (token == null) {
				logger.info("The cloud token is not in this user's keychain (a settings file from elsewhere?): the login is asked for again");
				return null;
			}
			cached = token;
			return token;
		} catch (IOException e) {
			logger.warn("The keychain could not be read: {}", e.getMessage());
			return null;
		}
	}

	@Override
	public void forget() {
		cached = null;
		try {
			runner.run(Arrays.asList(SECURITY, "delete-generic-password", "-a", ACCOUNT, "-s", SERVICE), "");
		} catch (IOException e) {
			logger.debug("The token could not be removed from the keychain: {}", e.getMessage());
		}
	}

	/** The token in the keychain, or null when there is none. */
	private String read() throws IOException {
		Result result = runner.run(Arrays.asList(SECURITY, "find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"), "");
		if (result.exit != 0) {
			if (result.exit != NOT_FOUND) {
				logger.warn("security find-generic-password ended with {}", result.exit);
			}
			return null;
		}
		String token = result.output.trim();
		return token.isEmpty() ? null : token;
	}

	private static Result run(List<String> command, String input) throws IOException {
		Process process = new ProcessBuilder(command).redirectErrorStream(false).start();
		try (OutputStream in = process.getOutputStream()) {
			in.write(input.getBytes(StandardCharsets.UTF_8));
		}
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try (InputStream stdout = process.getInputStream()) {
			stdout.transferTo(out);
		}
		try {
			if (!process.waitFor(15, TimeUnit.SECONDS)) {
				process.destroyForcibly();
				throw new IOException("security did not answer in 15 seconds");
			}
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IOException("interrupted", e);
		}
		return new Result(process.exitValue(), out.toString(StandardCharsets.UTF_8));
	}
}
