package org.openforis.collect.earth.app.service.dashboard;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import javax.annotation.PreDestroy;

import org.apache.commons.lang3.StringUtils;
import org.apache.http.entity.ContentType;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.BatchResult;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.Destination;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardProcess.Launcher;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardProcess.Ready;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.stereotype.Component;

/**
 * The dashboard on the person's own computer (docs/plans/2026-11-03-desktop-dashboard.md, Task 5): when the project
 * is not a cloud project, once it is loaded, starts the bundled Node with collect-earth-cloud's server in LOCAL_MODE
 * and feeds it.
 * <ul>
 * <li><b>Start:</b> in the background, on a thread of its own, so Collect Earth starts no later: {@code node
 * dashboard/server.mjs} on a free port of 127.0.0.1, its log in {@code dashboard.log} of the user folder. Once its
 * ready line is read (port, token, username) the feed starts.</li>
 * <li><b>Initial feed:</b> the project file (PUT /cep, the project folder zipped again), the plot file (PUT
 * /csv-files/&lt;name&gt;), then every record of the project through records:batch, made by the cloud sync's
 * serializer and sent by its client, under the dashboard's username. The server keeps everything in memory, so it is
 * fed again at each start: the desktop's database stays the only truth.</li>
 * <li><b>Live feed:</b> each save is noted (a listener next to the cloud sync's) and sent within seconds, once the
 * dashboard is ready. No durable queue: a dashboard that starts again is fed everything again anyway.</li>
 * <li><b>Restarts:</b> once if the server ends or does not start; a change of survey or plot file starts it again
 * (and refeeds it).</li>
 * <li><b>Stop:</b> on Quit (the Spring context closes), at the JVM's end (a shutdown hook), and a server left by a
 * Collect Earth that was killed is ended at the next start ({@code dashboard.pid}).</li>
 * </ul>
 * {@link #getState()} and {@link #newSignInUrl()} are for the menu entry "My dashboard" (Task 6).
 */
@Component
public class LocalDashboardService implements ApplicationListener<ContextRefreshedEvent> {

	/** Where the dashboard is. */
	public enum State {
		/** Not started: a cloud project (the cloud has the dashboard), or Collect Earth is quitting. */
		OFF,
		/** Not in this installation: no Node or no dashboard files. */
		UNAVAILABLE,
		/** Node is starting. */
		STARTING,
		/** Running, and being fed the project and its records: "Getting ready". */
		FEEDING,
		/** Running and up to date. */
		READY,
		/** It could not start, or ended twice: see {@link #getFailure()} and dashboard.log. */
		FAILED
	}

	static final String LOG_FILE = "dashboard.log"; //$NON-NLS-1$
	static final String PID_FILE = "dashboard.pid"; //$NON-NLS-1$
	static final String SERVER_SCRIPT = "server.mjs"; //$NON-NLS-1$
	static final String WEB_FOLDER = "web"; //$NON-NLS-1$
	/** A log above this size is started again at the next start, not appended to. */
	private static final long MAX_LOG_BYTES = 5L * 1024 * 1024;
	private static final long READY_TIMEOUT_MILLIS = 60_000;
	private static final int FEED_BATCH = 200;
	private static final int LIVE_BATCH = 100;
	private static final long LIVE_INTERVAL_MILLIS = 2_000;
	private static final long CHANGE_CHECK_MILLIS = 15_000;
	/** The project file sent: files of the project folder up to these sizes (the server takes up to 32 MB). */
	private static final long CEP_MAX_FILE_BYTES = 10L * 1024 * 1024;
	private static final long CEP_MAX_TOTAL_BYTES = 60L * 1024 * 1024;
	private static final int CEP_MAX_ENTRIES = 1500;
	private static final ContentType ZIP = ContentType.create("application/zip"); //$NON-NLS-1$
	private static final ContentType CSV = ContentType.create("text/csv"); //$NON-NLS-1$

	private final Logger logger = LoggerFactory.getLogger(LocalDashboardService.class);

	@Autowired
	private LocalPropertiesService localPropertiesService;
	@Autowired
	private EarthSurveyService earthSurveyService;
	@Autowired
	private EarthDashboardFeedSource earthFeedSource;
	@Autowired
	private CloudApiClient apiClient;

	private DashboardFeedSource source;
	private Launcher launcher = LocalDashboardProcess.SYSTEM_LAUNCHER;
	private File node;
	private File dashboardFolder;
	private File userFolder;
	private long readyTimeoutMillis = READY_TIMEOUT_MILLIS;
	private long changeCheckMillis = CHANGE_CHECK_MILLIS;
	private boolean configured;

	private volatile State state = State.OFF;
	private volatile String failure;
	private volatile LocalDashboardProcess process;
	private volatile Ready ready;
	private volatile Destination destination;
	/** Which start the current process is: an end or a feed of an earlier one is ignored. */
	private volatile int generation;
	private int restartsLeft;
	private String startedSignature;
	private volatile boolean stopping;
	private volatile long lastFeedMillis = -1;
	private volatile int lastFeedRecords;
	private final Set<String> savedKeys = new LinkedHashSet<>();
	private ScheduledExecutorService executor;
	private Thread shutdownHook;

	/** For Spring: the desktop's project, the cloud sync's client, the Node and the files the installation has. */
	public LocalDashboardService() {
	}

	/** For the tests: everything given. */
	LocalDashboardService(DashboardFeedSource source, CloudApiClient apiClient, Launcher launcher, File node,
			File dashboardFolder, File userFolder, long readyTimeoutMillis, long changeCheckMillis) {
		this.source = source;
		this.apiClient = apiClient;
		this.launcher = launcher;
		this.node = node;
		this.dashboardFolder = dashboardFolder;
		this.userFolder = userFolder;
		this.readyTimeoutMillis = readyTimeoutMillis;
		this.changeCheckMillis = changeCheckMillis;
		this.configured = true;
	}

	@Override
	public void onApplicationEvent(ContextRefreshedEvent event) {
		if (localPropertiesService.isUsingCloudDB()) {
			return; // a cloud project: the cloud has the dashboard
		}
		synchronized (this) {
			if (executor != null || stopping) {
				return; // the context can be refreshed more than once
			}
			earthSurveyService.addRecordSavedListener((recordKey, record) -> recordSaved(recordKey));
		}
		start();
	}

	/** Starts the dashboard in the background and returns at once. Does nothing the second time. */
	public synchronized void start() {
		if (executor != null || stopping) {
			return;
		}
		if (!configured) {
			File workingFolder = new File(System.getProperty("user.dir")).getAbsoluteFile(); //$NON-NLS-1$
			source = earthFeedSource;
			node = findNode(workingFolder);
			dashboardFolder = findDashboard(workingFolder);
			userFolder = new File(FolderFinder.getCollectEarthDataFolder());
			configured = true;
		}
		executor = Executors.newSingleThreadScheduledExecutor(r -> {
			Thread thread = new Thread(r, "CollectEarth-dashboard"); //$NON-NLS-1$
			thread.setDaemon(true);
			return thread;
		});
		shutdownHook = new Thread(() -> stopProcess(1000), "CollectEarth-dashboard-stop"); //$NON-NLS-1$
		try {
			Runtime.getRuntime().addShutdownHook(shutdownHook);
		} catch (IllegalStateException e) {
			return; // the JVM is ending already
		}
		executor.execute(() -> launch(true));
		executor.scheduleWithFixedDelay(this::sendSaved, LIVE_INTERVAL_MILLIS, LIVE_INTERVAL_MILLIS,
				TimeUnit.MILLISECONDS);
		executor.scheduleWithFixedDelay(this::checkChanges, changeCheckMillis, changeCheckMillis,
				TimeUnit.MILLISECONDS);
	}

	/** Called for every save: the record goes to the dashboard within seconds. Cheap, never throws. */
	public void recordSaved(String recordKey) {
		if (StringUtils.isBlank(recordKey) || stopping || state == State.UNAVAILABLE) {
			return;
		}
		synchronized (savedKeys) {
			savedKeys.add(recordKey);
		}
	}

	public State getState() {
		return state;
	}

	/** Why the dashboard failed, in English, for the logs; null unless {@link State#FAILED}. */
	public String getFailure() {
		return state == State.FAILED ? failure : null;
	}

	/**
	 * The text for the menu entry: "My dashboard", "Getting ready…", or why it cannot open; null when there is no
	 * dashboard (a cloud project).
	 */
	public String getStateText() {
		switch (state) {
		case STARTING:
		case FEEDING:
			return Messages.getString("LocalDashboard.gettingReady"); //$NON-NLS-1$
		case READY:
			return Messages.getString("LocalDashboard.menu"); //$NON-NLS-1$
		case FAILED:
			return MessageFormat.format(Messages.getString("LocalDashboard.failed"), logFile().getAbsolutePath()); //$NON-NLS-1$
		case UNAVAILABLE:
			return Messages.getString("LocalDashboard.notInstalled"); //$NON-NLS-1$
		default:
			return null;
		}
	}

	/** The port the dashboard listens on (127.0.0.1), or -1 when it is not running. */
	public int getPort() {
		Ready local = ready;
		return local == null || (state != State.FEEDING && state != State.READY) ? -1 : local.getPort();
	}

	/** What the running dashboard said when it started (its port and token), or null. For the tests. */
	Ready getReady() {
		return getPort() < 0 ? null : ready;
	}

	/** How long the last initial feed took, in ms, or -1 before the first one ended. */
	public long getLastFeedMillis() {
		return lastFeedMillis;
	}

	/** How many records the last initial feed sent. */
	public int getLastFeedRecords() {
		return lastFeedRecords;
	}

	/**
	 * A new one-time link that opens the dashboard in the browser, signed in (valid 15 minutes, once), or null when
	 * the dashboard is not running. While it is {@link State#FEEDING} the link works, and the figures fill in.
	 */
	public String newSignInUrl() throws IOException {
		Destination local = destination;
		if (local == null || (state != State.FEEDING && state != State.READY)) {
			return null;
		}
		return apiClient.newLocalSignInUrl(local);
	}

	/** Stops the dashboard for good: on Quit (the context closes) and in the tests. */
	@PreDestroy
	public void stop() {
		ScheduledExecutorService local;
		synchronized (this) {
			stopping = true;
			local = executor;
		}
		state = State.OFF;
		generation++;
		stopProcess(3000);
		if (local != null) {
			local.shutdownNow();
		}
		Thread hook = shutdownHook;
		if (hook != null && Thread.currentThread() != hook) {
			try {
				Runtime.getRuntime().removeShutdownHook(hook);
			} catch (IllegalStateException e) {
				// the JVM is ending: the hook runs anyway, and finds nothing left to do
			}
		}
	}

	private void stopProcess(long waitMillis) {
		LocalDashboardProcess local = process;
		if (local != null) {
			local.stop(waitMillis);
		}
		if (userFolder != null) {
			pidFile().delete();
		}
	}

	// --- On the dashboard's thread only, from here on

	private void launch(boolean fresh) {
		if (stopping) {
			return;
		}
		if (fresh) {
			restartsLeft = 1;
		}
		if (node == null || dashboardFolder == null) {
			state = State.UNAVAILABLE;
			logger.info("No dashboard in this installation (Node {}, dashboard files {})", node, dashboardFolder); //$NON-NLS-1$
			return;
		}
		String surveyUri = source.surveyUri();
		if (surveyUri == null) {
			fail("No survey is loaded"); //$NON-NLS-1$
			return;
		}
		state = State.STARTING;
		ready = null;
		destination = null;
		int gen = ++generation;
		startedSignature = source.signature();
		endLeftover();
		LocalDashboardProcess started = new LocalDashboardProcess(launcher, node,
				new File(dashboardFolder, SERVER_SCRIPT), new File(dashboardFolder, WEB_FOLDER), logFile(),
				readyTimeoutMillis);
		process = started;
		Ready answer;
		try {
			answer = started.start(settings(surveyUri));
		} catch (IOException | RuntimeException e) {
			logger.warn("The dashboard could not start: {}", e.getMessage()); //$NON-NLS-1$
			retryOrFail(e.getMessage());
			return;
		}
		if (stopping || gen != generation) {
			started.stop();
			return;
		}
		writePid(started.pid());
		ready = answer;
		destination = new Destination(answer.getBaseUrl(), answer.getProjectId(), answer.getApiToken());
		started.onExit().thenRun(() -> {
			ScheduledExecutorService local = executor;
			if (!stopping && local != null) {
				try {
					local.execute(() -> ended(gen));
				} catch (RejectedExecutionException e) {
					// stopping
				}
			}
		});
		logger.info("Dashboard listening on port {}", answer.getPort()); //$NON-NLS-1$
		state = State.FEEDING;
		try {
			feed(destination, answer.getUsername());
		} catch (IOException | RuntimeException e) {
			if (gen == generation && started.isAlive() && !stopping) {
				logger.warn("The dashboard could not be fed: {}", e.getMessage()); //$NON-NLS-1$
				generation++; // its end is not one to restart from
				started.stop();
				fail(e.getMessage());
			} // else it ended: ended() restarts it or says it failed
			return;
		}
		if (gen == generation && !stopping) {
			state = State.READY;
		}
	}

	private void retryOrFail(String reason) {
		if (restartsLeft > 0 && !stopping) {
			restartsLeft--;
			logger.info("Starting the dashboard again"); //$NON-NLS-1$
			launch(false);
		} else {
			fail(reason);
		}
	}

	private void fail(String reason) {
		failure = reason;
		state = State.FAILED;
		logger.warn("The dashboard is not available: {} (log: {})", reason, logFile().getAbsolutePath()); //$NON-NLS-1$
	}

	/** The process of start {@code gen} ended without being asked to. */
	private void ended(int gen) {
		if (stopping || gen != generation) {
			return;
		}
		LocalDashboardProcess ended = process;
		String exit = ""; //$NON-NLS-1$
		try {
			exit = ended == null ? "" : " with code " + ended.onExit().getNow(null).exitValue(); //$NON-NLS-1$ //$NON-NLS-2$
		} catch (RuntimeException e) {
			// unknown
		}
		logger.warn("The dashboard ended{}", exit); //$NON-NLS-1$
		ready = null;
		destination = null;
		retryOrFail("The dashboard ended" + exit); //$NON-NLS-1$
	}

	/** A change of survey, project folder or plot file: the dashboard starts again with them. */
	private void checkChanges() {
		try {
			if (stopping || startedSignature == null || state == State.UNAVAILABLE || state == State.OFF) {
				return;
			}
			String now = source.signature();
			if (now.equals(startedSignature)) {
				return;
			}
			logger.info("The project or its plot file changed: starting the dashboard again"); //$NON-NLS-1$
			generation++;
			LocalDashboardProcess old = process;
			if (old != null) {
				old.stop();
			}
			launch(true);
		} catch (RuntimeException e) {
			logger.debug("Dashboard change check failed: {}", e.getMessage()); //$NON-NLS-1$
		}
	}

	/** Sends the records saved since the last run, once the dashboard is ready. */
	private void sendSaved() {
		try {
			while (state == State.READY && !stopping) {
				List<String> keys = new ArrayList<>();
				synchronized (savedKeys) {
					Iterator<String> it = savedKeys.iterator();
					while (it.hasNext() && keys.size() < LIVE_BATCH) {
						keys.add(it.next());
						it.remove();
					}
				}
				if (keys.isEmpty()) {
					return;
				}
				Destination target = destination;
				Ready answer = ready;
				if (target == null || answer == null) {
					requeue(keys);
					return;
				}
				List<RecordEnvelope> envelopes = new ArrayList<>();
				for (String key : keys) {
					try {
						RecordEnvelope envelope = source.loadByKey(key);
						if (envelope != null) {
							envelopes.add(envelope.withOperator(answer.getUsername()));
						}
					} catch (IOException | RuntimeException e) {
						logger.debug("Record {} not sent to the dashboard: {}", key, e.getMessage()); //$NON-NLS-1$
					}
				}
				if (envelopes.isEmpty()) {
					continue;
				}
				try {
					apiClient.uploadRecordsBatch(target, envelopes);
				} catch (IOException e) {
					// the server ended (it is then started again and fed everything) or is busy: next run
					logger.debug("Saved records not sent to the dashboard yet: {}", e.getMessage()); //$NON-NLS-1$
					requeue(keys);
					return;
				}
			}
		} catch (RuntimeException e) {
			logger.debug("Error sending saved records to the dashboard: {}", e.getMessage()); //$NON-NLS-1$
		}
	}

	private void requeue(List<String> keys) {
		synchronized (savedKeys) {
			savedKeys.addAll(keys);
		}
	}

	/** The project file, the plot file and every record. A failed records:batch stops it (IOException). */
	void feed(Destination target, String username) throws IOException {
		long start = System.currentTimeMillis();
		File folder = source.projectFolder();
		if (folder != null && folder.isDirectory()) {
			try {
				apiClient.putProjectFile(target, "/cep", zipProjectFolder(folder.toPath()), ZIP); //$NON-NLS-1$
			} catch (IOException e) {
				logger.warn("The dashboard did not take the project file: {}", e.getMessage()); //$NON-NLS-1$
			}
		}
		File plots = source.plotFile();
		if (plots != null && plots.isFile()) {
			try {
				apiClient.putProjectFile(target, "/csv-files/" + urlEncode(plots.getName()), //$NON-NLS-1$
						Files.readAllBytes(plots.toPath()), CSV);
			} catch (IOException e) {
				logger.warn("The dashboard did not take the plot file {}: {}", plots.getName(), e.getMessage()); //$NON-NLS-1$
			}
		}
		List<Integer> ids = source.recordIds();
		int sent = 0;
		int refused = 0;
		long sendingMillis = 0;
		for (int from = 0; from < ids.size(); from += FEED_BATCH) {
			if (stopping) {
				throw new IOException("Stopping"); //$NON-NLS-1$
			}
			List<RecordEnvelope> envelopes = new ArrayList<>();
			for (Integer id : ids.subList(from, Math.min(ids.size(), from + FEED_BATCH))) {
				try {
					RecordEnvelope envelope = source.load(id);
					if (envelope != null) {
						envelopes.add(envelope.withOperator(username));
					}
				} catch (IOException | RuntimeException e) {
					logger.debug("Record {} not sent to the dashboard: {}", id, e.getMessage()); //$NON-NLS-1$
				}
			}
			if (envelopes.isEmpty()) {
				continue;
			}
			long sending = System.currentTimeMillis();
			List<BatchResult> results = apiClient.uploadRecordsBatch(target, envelopes);
			sendingMillis += System.currentTimeMillis() - sending;
			for (BatchResult result : results) {
				if ("error".equalsIgnoreCase(result.getStatus())) { //$NON-NLS-1$
					refused++;
				}
			}
			sent += envelopes.size();
		}
		lastFeedMillis = System.currentTimeMillis() - start;
		lastFeedRecords = sent;
		logger.info("Dashboard fed with {} records in {} ms, {} ms of it sending them{}", sent, lastFeedMillis, //$NON-NLS-1$
				sendingMillis, refused == 0 ? "" : " (" + refused + " refused)"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
	}

	private Map<String, String> settings(String surveyUri) {
		Map<String, String> settings = new LinkedHashMap<>();
		String operator = StringUtils.trimToNull(source.operator());
		if (operator != null) {
			settings.put("LOCAL_USER", operator); //$NON-NLS-1$
		}
		settings.put("LOCAL_PROJECT_ID", projectIdFor(surveyUri)); //$NON-NLS-1$
		String name = StringUtils.trimToNull(source.projectName());
		if (name != null) {
			settings.put("LOCAL_PROJECT_NAME", name); //$NON-NLS-1$
		}
		return settings;
	}

	/** The dashboard project's id: the same for a survey at every start, so that its links keep working. */
	static String projectIdFor(String surveyUri) {
		return UUID.nameUUIDFromBytes(("collect-earth-local-dashboard:" + surveyUri).getBytes(StandardCharsets.UTF_8)) //$NON-NLS-1$
				.toString();
	}

	/**
	 * The project folder as a project file (.cep): what Collect Earth unpacked it from, less any file above 10 MB
	 * (a guide in PDF, imagery) and within what the server accepts.
	 */
	static byte[] zipProjectFolder(Path folder) throws IOException {
		List<Path> files;
		try (Stream<Path> walk = Files.walk(folder)) {
			files = walk.filter(Files::isRegularFile).sorted().collect(Collectors.toList());
		}
		ByteArrayOutputStream bytes = new ByteArrayOutputStream();
		long total = 0;
		int entries = 0;
		try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
			for (Path file : files) {
				long size = Files.size(file);
				if (size > CEP_MAX_FILE_BYTES || total + size > CEP_MAX_TOTAL_BYTES || entries >= CEP_MAX_ENTRIES) {
					continue;
				}
				String name = folder.relativize(file).toString().replace(File.separatorChar, '/');
				zip.putNextEntry(new ZipEntry(name));
				Files.copy(file, zip);
				zip.closeEntry();
				total += size;
				entries++;
			}
		}
		return bytes.toByteArray();
	}

	private static String urlEncode(String name) {
		try {
			return URLEncoder.encode(name, "UTF-8").replace("+", "%20"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		} catch (UnsupportedEncodingException e) {
			throw new IllegalStateException(e);
		}
	}

	/** Node: the installation's ({@code node/}), else the developer build's (frontend-maven-plugin). */
	static File findNode(File workingFolder) {
		String executable = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows") //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
				? "node.exe" //$NON-NLS-1$
				: "node"; //$NON-NLS-1$
		for (String folder : new String[] { "node", "src/main/frontend/node" }) { //$NON-NLS-1$ //$NON-NLS-2$
			File candidate = new File(new File(workingFolder, folder), executable);
			if (candidate.isFile() && candidate.canExecute()) {
				return candidate;
			}
		}
		return null;
	}

	/** The dashboard's files: the installation's ({@code dashboard/}), else the build's ({@code target/dashboard}). */
	static File findDashboard(File workingFolder) {
		for (String folder : new String[] { "dashboard", "target/dashboard" }) { //$NON-NLS-1$ //$NON-NLS-2$
			File candidate = new File(workingFolder, folder);
			if (new File(candidate, SERVER_SCRIPT).isFile() && new File(new File(candidate, WEB_FOLDER), "index.html").isFile()) { //$NON-NLS-1$
				return candidate;
			}
		}
		return null;
	}

	private File logFile() {
		return new File(userFolder == null ? new File(".") : userFolder, LOG_FILE); //$NON-NLS-1$
	}

	private File pidFile() {
		return new File(userFolder, PID_FILE);
	}

	/** A log grown large is begun again; the server appends to it. */
	private void trimLog() {
		File log = logFile();
		if (log.length() > MAX_LOG_BYTES && !log.delete()) {
			logger.debug("Could not start {} again", log); //$NON-NLS-1$
		}
	}

	/** Ends the dashboard a Collect Earth that was killed left running, if its pid file names one. */
	private void endLeftover() {
		trimLog();
		File pidFile = pidFile();
		if (!pidFile.isFile()) {
			return;
		}
		try {
			long pid = Long.parseLong(new String(Files.readAllBytes(pidFile.toPath()), StandardCharsets.US_ASCII).trim());
			Optional<ProcessHandle> handle = ProcessHandle.of(pid);
			if (handle.isPresent() && handle.get().isAlive() && isDashboard(handle.get().info())) {
				logger.info("Ending the dashboard left running by an earlier Collect Earth (pid {})", pid); //$NON-NLS-1$
				handle.get().destroy();
			}
		} catch (IOException | RuntimeException e) {
			logger.debug("Dashboard pid file not read: {}", e.getMessage()); //$NON-NLS-1$
		}
		pidFile.delete();
	}

	/** Whether a process is a Node running server.mjs (the arguments are not known on every system). */
	static boolean isDashboard(ProcessHandle.Info info) {
		String command = info.command().orElse("").toLowerCase(Locale.ROOT); //$NON-NLS-1$
		if (!(command.endsWith("node") || command.endsWith("node.exe"))) { //$NON-NLS-1$ //$NON-NLS-2$
			return false;
		}
		Optional<String[]> arguments = info.arguments();
		if (!arguments.isPresent()) {
			return true;
		}
		for (String argument : arguments.get()) {
			if (argument.endsWith(SERVER_SCRIPT)) {
				return true;
			}
		}
		return false;
	}

	private void writePid(long pid) {
		if (pid <= 0) {
			return;
		}
		try {
			Files.write(pidFile().toPath(), Long.toString(pid).getBytes(StandardCharsets.US_ASCII));
		} catch (IOException e) {
			logger.debug("Dashboard pid file not written: {}", e.getMessage()); //$NON-NLS-1$
		}
	}
}
