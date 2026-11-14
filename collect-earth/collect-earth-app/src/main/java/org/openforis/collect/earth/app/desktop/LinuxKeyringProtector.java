package org.openforis.collect.earth.app.desktop;

import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.service.SecretProtector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The cloud token kept in the Linux desktop's keyring (GNOME Keyring, KWallet: whatever answers the freedesktop Secret
 * Service), not in earth.properties, which only says {@code keyring:cloud_sync_token} (recommendation 1 of the data
 * review); one item per server, its account the property's name ({@code cloud_sync_token <server>}). The keyring is reached with {@code secret-tool} (package libsecret-tools), given the token on its standard
 * input. Used only when that command is installed and a keyring answers in the user's desktop session; otherwise, as
 * on a server with no desktop, the token stays in earth.properties, which only its owner can read
 * (LocalPropertiesService.ownerOnly). Read once, then kept in memory: the sync reads the token every 30 seconds.
 */
public final class LinuxKeyringProtector implements SecretProtector {

	private static final Logger logger = LoggerFactory.getLogger(LinuxKeyringProtector.class);
	static final String PREFIX = "keyring:";
	static final String LABEL = "Collect Earth cloud token";
	/**
	 * The account of the single token of the versions before; each server's is the property's name,
	 * {@code cloud_sync_token <server>}
	 */
	static final String ACCOUNT = "cloud_sync_token";
	private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9._~+/=-]{1,4096}");

	private final SecretCommand.Runner runner;
	private final String secretTool;
	private final java.util.Map<String, String> cached = new java.util.concurrent.ConcurrentHashMap<>();

	LinuxKeyringProtector(SecretCommand.Runner runner, String secretTool) {
		this.runner = runner;
		this.secretTool = secretTool;
	}

	/**
	 * The protector on Linux when secret-tool is installed and a keyring answers in this session, else null (the token
	 * then stays in the owner-only settings file).
	 */
	public static SecretProtector ifAvailable() {
		if (!SystemUtils.IS_OS_LINUX || StringUtils.isBlank(System.getenv("DBUS_SESSION_BUS_ADDRESS"))) {
			return null;
		}
		String tool = onPath("secret-tool");
		if (tool == null) {
			logger.info("No secret-tool (package libsecret-tools): the cloud token stays in the settings file, readable by its owner only");
			return null;
		}
		LinuxKeyringProtector protector = new LinuxKeyringProtector(SecretCommand::run, tool);
		return protector.answers() ? protector : null;
	}

	/**
	 * Whether a keyring answers: a lookup finds the item (0), or finds nothing and says nothing (1). A missing or
	 * unreachable keyring says why on its error output.
	 */
	boolean answers() {
		try {
			SecretCommand.Result result = runner.run(command("lookup", ACCOUNT), "");
			if (result.exit == 0 || (result.exit == 1 && result.error.trim().isEmpty())) {
				return true;
			}
			logger.info("No keyring answers in this session ({}): the cloud token stays in the settings file, readable by its owner only",
					result.error.trim());
			return false;
		} catch (IOException e) {
			logger.info("The keyring could not be reached ({}): the cloud token stays in the settings file", e.getMessage());
			return false;
		}
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
		if (!TOKEN.matcher(plain).matches()) {
			throw new IllegalArgumentException("not a token the keyring is given");
		}
		try {
			List<String> store = command("store", account);
			store.add(2, "--label=" + LABEL);
			SecretCommand.Result result = runner.run(store, plain);
			cached.remove(account);
			if (result.exit != 0 || !plain.equals(read(account))) {
				throw new IllegalStateException("the keyring did not keep the token: " + result.error.trim());
			}
			cached.put(account, plain);
			return PREFIX + account;
		} catch (IOException e) {
			throw new IllegalStateException("secret-tool could not be run: " + e.getMessage(), e);
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
				logger.info("The cloud token is not in this user's keyring (a settings file from elsewhere, or the keyring locked): the login is asked for again");
				// "" for none, so the sync's reads every 30 s do not each run the command again (protect and forget clear it)
				cached.put(account, "");
				return null;
			}
			cached.put(account, token);
			return token;
		} catch (IOException e) {
			cached.put(account, "");
			logger.warn("The keyring could not be read: {}", e.getMessage());
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
			runner.run(command("clear", account), "");
		} catch (IOException e) {
			logger.debug("The token could not be removed from the keyring: {}", e.getMessage());
		}
	}

	private String read(String account) throws IOException {
		SecretCommand.Result result = runner.run(command("lookup", account), "");
		if (result.exit != 0) {
			return null;
		}
		String token = result.output.trim();
		return token.isEmpty() ? null : token;
	}

	/** secret-tool, the action, then the item's attributes: the account is the property's name */
	private List<String> command(String action, String account) {
		List<String> command = new java.util.ArrayList<>();
		command.add(secretTool);
		command.add(action);
		command.addAll(Arrays.asList("service", "collect-earth", "account", account));
		return command;
	}

	private static String onPath(String name) {
		String path = System.getenv("PATH");
		for (String folder : (path == null ? "/usr/bin:/bin" : path).split(File.pathSeparator)) {
			File file = new File(folder, name);
			if (file.canExecute()) {
				return file.getAbsolutePath();
			}
		}
		return null;
	}
}
