package org.openforis.collect.earth.app.service.dashboard;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.lang.ProcessBuilder.Redirect;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * One run of the local dashboard: {@code node server.mjs} in LOCAL_MODE (collect-earth-cloud, src/local.ts), its
 * log appended to a file, and the one JSON line it prints on stdout once it listens.
 * <p>
 * {@link #start(Map)} returns once that line is read, or throws when the process ends or stays silent first.
 * {@link #stop()} ends it: SIGTERM (the server closes itself), then a forced kill after a few seconds.
 * The launching is a {@link Launcher}, so that the tests can run a fake Node.
 */
public class LocalDashboardProcess {

	/** How a process is started: the real one runs a ProcessBuilder, the tests a fake. */
	public interface Launcher {
		Process launch(List<String> command, Map<String, String> environment, File workingFolder, File log)
				throws IOException;
	}

	/** Starts the command with stderr appended to the log file, stdout read by this class. */
	public static final Launcher SYSTEM_LAUNCHER = (command, environment, workingFolder, log) -> {
		ProcessBuilder builder = new ProcessBuilder(command).directory(workingFolder);
		// A NODE_OPTIONS of the user's (a --require, a debugger) must not change how the dashboard runs
		builder.environment().remove("NODE_OPTIONS"); //$NON-NLS-1$
		builder.environment().putAll(environment);
		builder.redirectError(Redirect.appendTo(log));
		return builder.start();
	};

	/** What the server says once it listens. */
	public static final class Ready {
		private final int port;
		private final String projectId;
		private final String username;
		private final String signInUrl;
		private final String apiToken;

		Ready(int port, String projectId, String username, String signInUrl, String apiToken) {
			this.port = port;
			this.projectId = projectId;
			this.username = username;
			this.signInUrl = signInUrl;
			this.apiToken = apiToken;
		}

		public int getPort() {
			return port;
		}

		public String getProjectId() {
			return projectId;
		}

		/** The account's username: the records are sent with it as their operator. */
		public String getUsername() {
			return username;
		}

		/** A one-time link that opens the dashboard signed in. */
		public String getSignInUrl() {
			return signInUrl;
		}

		/** The desktop's session (Authorization: Bearer). */
		public String getApiToken() {
			return apiToken;
		}

		public String getBaseUrl() {
			return "http://127.0.0.1:" + port; //$NON-NLS-1$
		}
	}

	private static final ObjectMapper JSON = new ObjectMapper();
	private static final long STOP_WAIT_MILLIS = 3000;

	private final Logger logger = LoggerFactory.getLogger(LocalDashboardProcess.class);

	private final Launcher launcher;
	private final File node;
	private final File serverScript;
	private final File webFolder;
	private final File log;
	private final long readyTimeoutMillis;

	private volatile Process process;

	public LocalDashboardProcess(Launcher launcher, File node, File serverScript, File webFolder, File log,
			long readyTimeoutMillis) {
		this.launcher = launcher;
		this.node = node;
		this.serverScript = serverScript;
		this.webFolder = webFolder;
		this.log = log;
		this.readyTimeoutMillis = readyTimeoutMillis;
	}

	/**
	 * Starts the server and waits for its ready line.
	 *
	 * @param settings the environment the server reads besides LOCAL_MODE, PORT, HOST and WEB_DIR: LOCAL_USER,
	 *                 LOCAL_PROJECT_ID, LOCAL_PROJECT_NAME
	 * @throws IOException when it cannot start, ends before it is ready, or is not ready in time (it is then
	 *                     stopped)
	 */
	public Ready start(Map<String, String> settings) throws IOException {
		if (process != null) {
			throw new IllegalStateException("This dashboard process was started already"); //$NON-NLS-1$
		}
		List<String> command = new ArrayList<>();
		command.add(node.getAbsolutePath());
		command.add(serverScript.getAbsolutePath());
		Map<String, String> environment = new java.util.LinkedHashMap<>(settings);
		environment.put("LOCAL_MODE", "1"); //$NON-NLS-1$ //$NON-NLS-2$
		environment.put("PORT", "0"); //$NON-NLS-1$ //$NON-NLS-2$
		environment.put("HOST", "127.0.0.1"); //$NON-NLS-1$ //$NON-NLS-2$
		// The server refuses a relative WEB_DIR
		environment.put("WEB_DIR", webFolder.getAbsolutePath()); //$NON-NLS-1$
		// Its stdin is a pipe from here (ProcessBuilder's default), which the system closes when Collect Earth ends,
		// even killed: the server then ends too
		environment.put("LOCAL_EXIT_WITH_STDIN", "1"); //$NON-NLS-1$ //$NON-NLS-2$

		Process started = launcher.launch(command, environment, serverScript.getAbsoluteFile().getParentFile(), log);
		process = started;
		CompletableFuture<Ready> ready = new CompletableFuture<>();
		Thread reader = new Thread(() -> readStdout(started, ready), "CollectEarth-dashboard-stdout"); //$NON-NLS-1$
		reader.setDaemon(true);
		reader.start();
		try {
			return ready.get(readyTimeoutMillis, TimeUnit.MILLISECONDS);
		} catch (TimeoutException e) {
			stop();
			throw new IOException("The dashboard was not ready after " + readyTimeoutMillis / 1000 + " s"); //$NON-NLS-1$ //$NON-NLS-2$
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			stop();
			throw new IOException("Interrupted while the dashboard was starting", e); //$NON-NLS-1$
		} catch (ExecutionException e) {
			stop();
			Throwable cause = e.getCause();
			throw cause instanceof IOException ? (IOException) cause : new IOException(cause);
		}
	}

	/**
	 * Reads stdout to its end: the ready line completes {@code ready}; anything else (nothing, normally) goes to the
	 * log of this class. The end of the stream before the ready line fails it.
	 */
	private void readStdout(Process started, CompletableFuture<Ready> ready) {
		try (BufferedReader reader = new BufferedReader(
				new InputStreamReader(started.getInputStream(), StandardCharsets.UTF_8))) {
			String line;
			while ((line = reader.readLine()) != null) {
				Ready parsed = ready.isDone() ? null : parseReadyLine(line);
				if (parsed != null) {
					ready.complete(parsed);
				} else if (!line.trim().isEmpty()) {
					logger.info("Dashboard: {}", line); //$NON-NLS-1$
				}
			}
		} catch (IOException e) {
			logger.debug("Dashboard output closed: {}", e.getMessage()); //$NON-NLS-1$
		}
		if (!ready.isDone()) {
			ready.completeExceptionally(
					new IOException("The dashboard ended before it was ready (see " + log.getAbsolutePath() + ")")); //$NON-NLS-1$ //$NON-NLS-2$
		}
	}

	/** The ready line, or null for any other line. */
	static Ready parseReadyLine(String line) {
		String trimmed = line == null ? "" : line.trim(); //$NON-NLS-1$
		if (!trimmed.startsWith("{")) { //$NON-NLS-1$
			return null;
		}
		try {
			JsonNode json = JSON.readTree(trimmed);
			if (!json.path("ready").asBoolean(false) || !json.path("port").canConvertToInt()) { //$NON-NLS-1$ //$NON-NLS-2$
				return null;
			}
			int port = json.path("port").asInt(); //$NON-NLS-1$
			String apiToken = json.path("apiToken").asText(null); //$NON-NLS-1$
			if (port <= 0 || port > 65535 || apiToken == null || apiToken.isEmpty()) {
				return null;
			}
			return new Ready(port, json.path("projectId").asText(null), json.path("username").asText(null), //$NON-NLS-1$ //$NON-NLS-2$
					json.path("signInUrl").asText(null), apiToken); //$NON-NLS-1$
		} catch (IOException e) {
			return null;
		}
	}

	public boolean isAlive() {
		Process local = process;
		return local != null && local.isAlive();
	}

	/** Completes when the process ends, whoever ended it. */
	public CompletableFuture<Process> onExit() {
		Process local = process;
		if (local == null) {
			throw new IllegalStateException("Not started"); //$NON-NLS-1$
		}
		return local.onExit();
	}

	/** The process id, or -1 when unknown. */
	public long pid() {
		Process local = process;
		try {
			return local == null ? -1 : local.pid();
		} catch (UnsupportedOperationException e) {
			return -1;
		}
	}

	/** Ends the server: politely first, then forcibly. Safe to call more than once, and before a start. */
	public void stop() {
		stop(STOP_WAIT_MILLIS);
	}

	void stop(long waitMillis) {
		Process local = process;
		if (local == null || !local.isAlive()) {
			return;
		}
		local.destroy();
		try {
			if (!local.waitFor(waitMillis, TimeUnit.MILLISECONDS)) {
				local.destroyForcibly();
			}
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			local.destroyForcibly();
		}
	}
}
