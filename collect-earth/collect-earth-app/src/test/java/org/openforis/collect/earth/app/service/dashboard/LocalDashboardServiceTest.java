package org.openforis.collect.earth.app.service.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.BatchResult;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.Destination;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardProcess.Launcher;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardProcess.Ready;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardService.State;

/** LocalDashboardService and LocalDashboardProcess with a fake Node: start, ready line, feed, restart, stop. */
public class LocalDashboardServiceTest {

	private static final String SURVEY_URI = "http://openforis.org/test/survey";

	@TempDir
	File folder;

	private final CloudApiClient api = mock(CloudApiClient.class);
	private final FakeLauncher launcher = new FakeLauncher();
	private TestSource source;
	private File node;
	private File dashboard;
	private File user;
	private LocalDashboardService service;

	@BeforeEach
	public void setUp() throws Exception {
		node = new File(folder, "node");
		Files.write(node.toPath(), new byte[0]);
		dashboard = new File(folder, "dashboard");
		new File(dashboard, "web").mkdirs();
		Files.write(new File(dashboard, "server.mjs").toPath(), new byte[0]);
		user = new File(folder, "user");
		user.mkdirs();
		File project = new File(folder, "project");
		project.mkdirs();
		Files.write(new File(project, "placemark.idm.xml").toPath(), "<survey/>".getBytes(StandardCharsets.UTF_8));
		File plots = new File(project, "my plots.csv");
		Files.write(plots.toPath(), "id,lat,lon\n1,1,1\n".getBytes(StandardCharsets.UTF_8));
		source = new TestSource(project, plots, Arrays.asList("1", "2", "3"));
		when(api.uploadRecordsBatch(any(Destination.class), anyList())).thenAnswer(invocation -> {
			List<BatchResult> results = new ArrayList<>();
			for (Object envelope : invocation.getArgument(1, List.class)) {
				results.add(new BatchResult(((RecordEnvelope) envelope).getRecordKey(), "stored", null));
			}
			return results;
		});
	}

	@AfterEach
	public void tearDown() {
		if (service != null) {
			service.stop();
		}
	}

	private LocalDashboardService service(long readyTimeoutMillis, long changeCheckMillis) {
		service = new LocalDashboardService(source, api, launcher, node, dashboard, user, readyTimeoutMillis,
				changeCheckMillis);
		return service;
	}

	@Test
	public void itStartsNodeReadsTheReadyLineAndFeedsTheProjectAndEveryRecord() throws Exception {
		service(5000, 60_000).start();
		waitFor(() -> service.getState() == State.READY, "ready");

		assertEquals(1, launcher.launches.size());
		Launch launch = launcher.launches.get(0);
		assertEquals(Arrays.asList(node.getAbsolutePath(), new File(dashboard, "server.mjs").getAbsolutePath()), launch.command);
		assertEquals("1", launch.environment.get("LOCAL_MODE"));
		assertEquals("0", launch.environment.get("PORT"), "a free port");
		assertEquals("127.0.0.1", launch.environment.get("HOST"));
		assertEquals(new File(dashboard, "web").getAbsolutePath(), launch.environment.get("WEB_DIR"));
		assertEquals("Ana María", launch.environment.get("LOCAL_USER"));
		assertEquals("Forest survey", launch.environment.get("LOCAL_PROJECT_NAME"));
		assertEquals(LocalDashboardService.projectIdFor(SURVEY_URI), launch.environment.get("LOCAL_PROJECT_ID"));
		assertEquals(new File(user, "dashboard.log"), launch.log);

		assertEquals(40001, service.getPort(), "the port of the ready line");
		ArgumentCaptor<Destination> destination = ArgumentCaptor.forClass(Destination.class);
		verify(api).putProjectFile(destination.capture(), eq("/cep"), any(byte[].class), any());
		assertEquals("http://127.0.0.1:40001", destination.getValue().getBaseUrl());
		assertEquals("token-1", destination.getValue().getToken());
		assertEquals(LocalDashboardService.projectIdFor(SURVEY_URI), destination.getValue().getProjectId());
		verify(api).putProjectFile(any(Destination.class), eq("/csv-files/my%20plots.csv"), any(byte[].class), any());
		@SuppressWarnings("unchecked")
		ArgumentCaptor<List<RecordEnvelope>> batch = ArgumentCaptor.forClass(List.class);
		verify(api).uploadRecordsBatch(any(Destination.class), batch.capture());
		assertEquals(3, batch.getValue().size());
		for (RecordEnvelope envelope : batch.getValue()) {
			assertEquals("Ana.Maria", envelope.getOperator(), "sent under the ready line's username");
		}
		assertEquals(3, service.getLastFeedRecords());
		assertTrue(service.getLastFeedMillis() >= 0);
		assertNull(service.getFailure());
	}

	@Test
	public void theSignInLinkComesFromTheRunningDashboard() throws Exception {
		service(5000, 60_000);
		assertNull(service.newSignInUrl(), "no link before it runs");
		when(api.newLocalSignInUrl(any(Destination.class))).thenReturn("http://127.0.0.1:40001/local-sign-in/abc");
		service.start();
		waitFor(() -> service.getState() == State.READY, "ready");
		assertEquals("http://127.0.0.1:40001/local-sign-in/abc", service.newSignInUrl());
	}

	@Test
	public void itIsStartedAgainOnceWhenItEndsThenFails() throws Exception {
		service(5000, 60_000).start();
		waitFor(() -> service.getState() == State.READY, "ready");

		launcher.launches.get(0).process.end(1);
		waitFor(() -> launcher.launches.size() == 2 && service.getState() == State.READY, "started again");
		assertEquals(40002, service.getPort(), "the new port");
		verify(api, times(2)).putProjectFile(any(Destination.class), eq("/cep"), any(byte[].class), any());
		verify(api, times(2)).uploadRecordsBatch(any(Destination.class), anyList());

		launcher.launches.get(1).process.end(1);
		waitFor(() -> service.getState() == State.FAILED, "failed");
		Thread.sleep(300);
		assertEquals(2, launcher.launches.size(), "only once");
		assertEquals(-1, service.getPort());
		assertTrue(service.getFailure().contains("ended"), service.getFailure());
	}

	@Test
	public void aStartThatNeverSaysReadyIsTriedTwiceThenFails() throws Exception {
		launcher.silent = true;
		service(300, 60_000).start();
		waitFor(() -> service.getState() == State.FAILED, "failed");
		assertEquals(2, launcher.launches.size());
		for (Launch launch : launcher.launches) {
			assertTrue(launch.process.destroyed, "a silent process is stopped");
		}
		assertTrue(service.getFailure().contains("not ready"), service.getFailure());
	}

	@Test
	public void stoppingEndsTheProcessAndItIsNotStartedAgain() throws Exception {
		service(5000, 60_000).start();
		waitFor(() -> service.getState() == State.READY, "ready");
		FakeProcess process = launcher.launches.get(0).process;
		service.stop();
		assertTrue(process.destroyed);
		assertFalse(process.isAlive());
		assertEquals(State.OFF, service.getState());
		Thread.sleep(300);
		assertEquals(1, launcher.launches.size());
	}

	@Test
	public void eachSaveIsSentWithinSeconds() throws Exception {
		service(5000, 60_000).start();
		waitFor(() -> service.getState() == State.READY, "ready");
		service.recordSaved("7");
		@SuppressWarnings("unchecked")
		ArgumentCaptor<List<RecordEnvelope>> batch = ArgumentCaptor.forClass(List.class);
		waitFor(() -> source.loadedByKey.contains("7"), "the save loaded");
		verify(api, org.mockito.Mockito.timeout(5000).times(2)).uploadRecordsBatch(any(Destination.class), batch.capture());
		List<RecordEnvelope> live = batch.getAllValues().get(1);
		assertEquals(1, live.size());
		assertEquals("7", live.get(0).getRecordKey());
		assertEquals("Ana.Maria", live.get(0).getOperator());
	}

	@Test
	public void aNewPlotFileStartsItAgainAndFeedsItAgain() throws Exception {
		service(5000, 200).start();
		waitFor(() -> service.getState() == State.READY, "ready");
		FakeProcess first = launcher.launches.get(0).process;
		source.plotsVersion = "2";
		waitFor(() -> launcher.launches.size() == 2 && service.getState() == State.READY, "started again");
		assertTrue(first.destroyed, "the old one is stopped");
		verify(api, atLeast(2)).putProjectFile(any(Destination.class), eq("/csv-files/my%20plots.csv"), any(byte[].class), any());
	}

	@Test
	public void withoutNodeOrTheDashboardFilesItIsUnavailable() throws Exception {
		service = new LocalDashboardService(source, api, launcher, null, dashboard, user, 5000, 60_000);
		service.start();
		waitFor(() -> service.getState() == State.UNAVAILABLE, "unavailable");
		assertTrue(launcher.launches.isEmpty());
	}

	@Test
	public void nodeAndTheDashboardAreFoundWhereTheInstallationAndTheBuildPutThem() throws Exception {
		File working = new File(folder, "app");
		assertNull(LocalDashboardService.findNode(working));
		assertNull(LocalDashboardService.findDashboard(working));
		String executable = System.getProperty("os.name").toLowerCase(Locale.ROOT).startsWith("windows") ? "node.exe" : "node";
		File devNode = new File(working, "src/main/frontend/node/" + executable);
		devNode.getParentFile().mkdirs();
		Files.write(devNode.toPath(), new byte[0]);
		devNode.setExecutable(true);
		assertEquals(devNode, LocalDashboardService.findNode(working));
		File installedNode = new File(working, "node/" + executable);
		installedNode.getParentFile().mkdirs();
		Files.write(installedNode.toPath(), new byte[0]);
		installedNode.setExecutable(true);
		assertEquals(installedNode, LocalDashboardService.findNode(working), "the installation's first");

		File built = new File(working, "target/dashboard");
		new File(built, "web").mkdirs();
		Files.write(new File(built, "server.mjs").toPath(), new byte[0]);
		assertNull(LocalDashboardService.findDashboard(working), "not without the web app");
		Files.write(new File(built, "web/index.html").toPath(), new byte[0]);
		assertEquals(built, LocalDashboardService.findDashboard(working));
	}

	@Test
	public void theReadyLineIsReadAndOtherLinesAreNot() {
		Ready ready = LocalDashboardProcess.parseReadyLine(
				"{\"ready\":true,\"port\":35303,\"projectId\":\"5fd61348-6b37-4ba1-a9ed-f32556f3db27\",\"username\":\"Ana.Maria\","
						+ "\"signInUrl\":\"http://127.0.0.1:35303/local-sign-in/kf\",\"apiToken\":\"Awfd\"}");
		assertNotNull(ready);
		assertEquals(35303, ready.getPort());
		assertEquals("5fd61348-6b37-4ba1-a9ed-f32556f3db27", ready.getProjectId());
		assertEquals("Ana.Maria", ready.getUsername());
		assertEquals("http://127.0.0.1:35303/local-sign-in/kf", ready.getSignInUrl());
		assertEquals("Awfd", ready.getApiToken());
		assertEquals("http://127.0.0.1:35303", ready.getBaseUrl());
		assertNull(LocalDashboardProcess.parseReadyLine("{\"level\":30,\"msg\":\"Server listening\"}"));
		assertNull(LocalDashboardProcess.parseReadyLine("{\"ready\":false,\"port\":1,\"apiToken\":\"x\"}"));
		assertNull(LocalDashboardProcess.parseReadyLine("{\"ready\":true,\"port\":0,\"apiToken\":\"x\"}"));
		assertNull(LocalDashboardProcess.parseReadyLine("{\"ready\":true,\"port\":80}"), "no token");
		assertNull(LocalDashboardProcess.parseReadyLine("{\"ready\":tr"));
		assertNull(LocalDashboardProcess.parseReadyLine("Listening"));
		assertNull(LocalDashboardProcess.parseReadyLine(null));
	}

	@Test
	public void theProjectIdIsAUuidThatStaysForASurvey() {
		String id = LocalDashboardService.projectIdFor(SURVEY_URI);
		assertTrue(id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"), id);
		assertEquals(id, LocalDashboardService.projectIdFor(SURVEY_URI));
		assertFalse(id.equals(LocalDashboardService.projectIdFor(SURVEY_URI + "2")));
	}

	@Test
	public void theProjectFileHasTheFolderLessItsLargeFiles() throws Exception {
		File project = new File(folder, "zipped");
		new File(project, "grid").mkdirs();
		Files.write(new File(project, "project_definition.properties").toPath(), "survey_name=x\n".getBytes(StandardCharsets.UTF_8));
		Files.write(new File(project, "grid/plots.csv").toPath(), "id\n1\n".getBytes(StandardCharsets.UTF_8));
		Files.write(new File(project, "guide.pdf").toPath(), new byte[11 * 1024 * 1024]);
		List<String> names = new ArrayList<>();
		try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(LocalDashboardService.zipProjectFolder(project.toPath())))) {
			ZipEntry entry;
			while ((entry = zip.getNextEntry()) != null) {
				names.add(entry.getName());
			}
		}
		assertEquals(Arrays.asList("grid/plots.csv", "project_definition.properties"), names);
	}

	/** A real process: a shell script as Node, which prints the ready line from its environment and waits. */
	@Test
	public void aRealProcessIsStartedReadAndStopped() throws Exception {
		assumeTrue(new File("/bin/sh").canExecute(), "needs /bin/sh");
		File script = new File(dashboard, "server.mjs");
		Files.write(script.toPath(), ("echo \"starting on $HOST\" >&2\n"
				+ "echo '{\"ready\":true,\"port\":4321,\"projectId\":\"'$LOCAL_PROJECT_ID'\",\"username\":\"'$LOCAL_USER'\",\"signInUrl\":\"u\",\"apiToken\":\"t\"}'\n"
				+ "exec sleep 60\n").getBytes(StandardCharsets.UTF_8));
		File log = new File(user, "dashboard.log");
		LocalDashboardProcess process = new LocalDashboardProcess(LocalDashboardProcess.SYSTEM_LAUNCHER, new File("/bin/sh"),
				script, new File(dashboard, "web"), log, 10_000);
		Map<String, String> settings = new HashMap<>();
		settings.put("LOCAL_USER", "ana");
		settings.put("LOCAL_PROJECT_ID", "p-1");
		Ready ready = process.start(settings);
		assertEquals(4321, ready.getPort());
		assertEquals("p-1", ready.getProjectId());
		assertEquals("ana", ready.getUsername());
		assertTrue(process.isAlive());
		assertTrue(process.pid() > 0);
		assertTrue(new String(Files.readAllBytes(log.toPath()), StandardCharsets.UTF_8).contains("starting on 127.0.0.1"), "stderr goes to the log");
		process.stop();
		assertFalse(process.isAlive());
		assertFalse(process.onExit().get(5, TimeUnit.SECONDS).isAlive());
		assertThrows(IllegalStateException.class, () -> process.start(settings), "one run per instance");
	}

	@Test
	public void aRealProcessThatEndsBeforeItIsReadyFails() throws Exception {
		assumeTrue(new File("/bin/sh").canExecute(), "needs /bin/sh");
		File script = new File(dashboard, "server.mjs");
		Files.write(script.toPath(), "echo 'Error: no' >&2\nexit 1\n".getBytes(StandardCharsets.UTF_8));
		LocalDashboardProcess process = new LocalDashboardProcess(LocalDashboardProcess.SYSTEM_LAUNCHER, new File("/bin/sh"),
				script, new File(dashboard, "web"), new File(user, "dashboard.log"), 10_000);
		IOException e = assertThrows(IOException.class, () -> process.start(Collections.emptyMap()));
		assertTrue(e.getMessage().contains("ended before it was ready"), e.getMessage());
	}

	private static void waitFor(BooleanSupplier condition, String what) throws InterruptedException {
		long until = System.currentTimeMillis() + 10_000;
		while (!condition.getAsBoolean()) {
			if (System.currentTimeMillis() > until) {
				throw new AssertionError("Timed out waiting for: " + what);
			}
			Thread.sleep(20);
		}
	}

	private static final class TestSource implements DashboardFeedSource {
		private final File project;
		private final File plots;
		private final List<String> keys;
		final List<String> loadedByKey = new CopyOnWriteArrayList<>();
		volatile String plotsVersion = "1";

		TestSource(File project, File plots, List<String> keys) {
			this.project = project;
			this.plots = plots;
			this.keys = keys;
		}

		@Override
		public String surveyUri() {
			return SURVEY_URI;
		}

		@Override
		public String projectName() {
			return "Forest survey";
		}

		@Override
		public String operator() {
			return "Ana María";
		}

		@Override
		public File projectFolder() {
			return project;
		}

		@Override
		public File plotFile() {
			return plots;
		}

		@Override
		public List<Integer> recordIds() {
			List<Integer> ids = new ArrayList<>();
			for (int i = 0; i < keys.size(); i++) {
				ids.add(i);
			}
			return ids;
		}

		@Override
		public RecordEnvelope load(int recordId) {
			return envelope(keys.get(recordId));
		}

		@Override
		public RecordEnvelope loadByKey(String recordKey) {
			loadedByKey.add(recordKey);
			return envelope(recordKey);
		}

		private RecordEnvelope envelope(String key) {
			// a tombstone is the one envelope made outside the serializer's package; the operator is what matters here
			return CloudRecordSerializer.tombstone(key, SURVEY_URI, "Ana María", new Date());
		}

		@Override
		public String signature() {
			return SURVEY_URI + "|" + plotsVersion;
		}
	}

	private static final class Launch {
		final List<String> command;
		final Map<String, String> environment;
		final File log;
		final FakeProcess process;

		Launch(List<String> command, Map<String, String> environment, File log, FakeProcess process) {
			this.command = command;
			this.environment = environment;
			this.log = log;
			this.process = process;
		}
	}

	/** Each launch is a fake process that prints the ready line at once (port 40000 + its number), unless silent. */
	private static final class FakeLauncher implements Launcher {
		final List<Launch> launches = new CopyOnWriteArrayList<>();
		volatile boolean silent;

		@Override
		public Process launch(List<String> command, Map<String, String> environment, File workingFolder, File log) {
			FakeProcess process = new FakeProcess();
			int n = launches.size() + 1;
			launches.add(new Launch(command, environment, log, process));
			if (!silent) {
				process.say("{\"level\":30,\"msg\":\"not the ready line\"}");
				process.say("{\"ready\":true,\"port\":" + (40000 + n) + ",\"projectId\":\"" + environment.get("LOCAL_PROJECT_ID")
						+ "\",\"username\":\"Ana.Maria\",\"signInUrl\":\"http://127.0.0.1:" + (40000 + n)
						+ "/local-sign-in/x\",\"apiToken\":\"token-" + n + "\"}");
			}
			return process;
		}
	}

	/** A process whose stdout the test writes, that ends when told to or destroyed. */
	private static final class FakeProcess extends Process {
		private static final int EOF = -1;
		private final BlockingQueue<Integer> stdout = new LinkedBlockingQueue<>();
		private final CountDownLatch done = new CountDownLatch(1);
		private volatile int exit;
		volatile boolean destroyed;

		void say(String line) {
			for (byte b : (line + "\n").getBytes(StandardCharsets.UTF_8)) {
				stdout.add(b & 0xff);
			}
		}

		synchronized void end(int code) {
			if (done.getCount() == 0) {
				return;
			}
			exit = code;
			stdout.add(EOF);
			done.countDown();
		}

		@Override
		public OutputStream getOutputStream() {
			return new ByteArrayOutputStream();
		}

		@Override
		public InputStream getInputStream() {
			return new InputStream() {
				private boolean ended;

				@Override
				public int read() throws IOException {
					byte[] one = new byte[1];
					return read(one, 0, 1) < 0 ? -1 : one[0] & 0xff;
				}

				@Override
				public int read(byte[] b, int off, int len) throws IOException {
					if (ended) {
						return -1;
					}
					try {
						int first = stdout.take();
						if (first == EOF) {
							ended = true;
							return -1;
						}
						b[off] = (byte) first;
						int n = 1;
						Integer next;
						while (n < len && (next = stdout.peek()) != null && next != EOF) {
							b[off + n++] = (byte) (int) stdout.poll();
						}
						return n;
					} catch (InterruptedException e) {
						Thread.currentThread().interrupt();
						throw new IOException(e);
					}
				}
			};
		}

		@Override
		public InputStream getErrorStream() {
			return new ByteArrayInputStream(new byte[0]);
		}

		@Override
		public int waitFor() throws InterruptedException {
			done.await();
			return exit;
		}

		@Override
		public boolean waitFor(long timeout, TimeUnit unit) throws InterruptedException {
			return done.await(timeout, unit);
		}

		@Override
		public int exitValue() {
			if (done.getCount() > 0) {
				throw new IllegalThreadStateException();
			}
			return exit;
		}

		@Override
		public void destroy() {
			destroyed = true;
			end(143);
		}

		@Override
		public boolean isAlive() {
			return done.getCount() > 0;
		}
	}
}
