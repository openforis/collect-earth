package org.openforis.collect.earth.app.service.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.stream.Stream;

import org.apache.commons.io.FileUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardProcess.Ready;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardService.State;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.collect.model.validation.CollectValidator;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CodeListItem;
import org.openforis.idm.metamodel.CodeListService;
import org.openforis.idm.metamodel.ModelVersion;
import org.openforis.idm.model.BooleanAttribute;
import org.openforis.idm.model.BooleanValue;
import org.openforis.idm.model.Code;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.TextValue;
import org.openforis.idm.model.expression.ExpressionFactory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import net.lingala.zip4j.ZipFile;

/**
 * The real dashboard: the Node bundle of collect-earth-cloud run by the Node of the build (or the system's), fed the
 * demo project (resources/demo_survey.cep), its plot file and records made of its survey through the cloud sync's
 * serializer, then asked for /progress. Skipped when Node or the bundle is missing.
 * <p>
 * With the environment variable DASHBOARD_FEED_10K=1, also feeds 10,000 records and prints how long it took.
 */
public class LocalDashboardIntegrationTest {

	private static final ObjectMapper JSON = new ObjectMapper();
	private static final File WORKING = new File(".").getAbsoluteFile();
	private static File node;
	private static File bundle;
	private static File demoCep;

	@TempDir
	static File shared;
	@TempDir
	File folder;

	private CollectSurvey survey;
	private RecordUpdater updater;
	private File project;
	private LocalDashboardService service;

	@BeforeAll
	public static void findNodeAndBundle() throws IOException {
		node = LocalDashboardService.findNode(WORKING);
		if (node == null) {
			node = onPath("node");
		}
		bundle = LocalDashboardService.findDashboard(WORKING);
		if (bundle == null) {
			// collect-earth-cloud's own folders, as `npm run build:local` and `vite build` leave them
			File cloud = new File(WORKING, "../../collect-earth-cloud").getCanonicalFile();
			File server = new File(cloud, "dist/server.mjs");
			File web = new File(cloud, "web/dist");
			if (server.isFile() && new File(web, "index.html").isFile()) {
				bundle = new File(shared, "dashboard");
				FileUtils.copyDirectory(server.getParentFile(), bundle);
				FileUtils.copyDirectory(web, new File(bundle, "web"));
			}
		}
		demoCep = new File(WORKING, "resources/demo_survey.cep");
	}

	private static File onPath(String name) {
		String path = System.getenv("PATH");
		if (path == null) {
			return null;
		}
		for (String entry : path.split(File.pathSeparator)) {
			for (String candidate : new String[] { name, name + ".exe" }) {
				File file = new File(entry, candidate);
				if (file.isFile() && file.canExecute()) {
					return file;
				}
			}
		}
		return null;
	}

	@BeforeEach
	public void setUp() throws Exception {
		assumeTrue(node != null, "no Node");
		assumeTrue(bundle != null, "no dashboard bundle (collect-earth-cloud: npm run build:local, web: npx vite build)");
		assumeTrue(demoCep.isFile(), "no demo project");
		project = new File(folder, "project");
		try (ZipFile zip = new ZipFile(demoCep)) {
			zip.extractAll(project.getAbsolutePath());
		}
		CollectSurveyContext context = new CollectSurveyContext(new ExpressionFactory(), new CollectValidator(),
				new EmptyCodeListService());
		try (InputStream in = Files.newInputStream(new File(project, "placemark.idm.xml").toPath())) {
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(context).unmarshal(in, true);
		}
		updater = new RecordUpdater();
		updater.setValidateAfterUpdate(false);
	}

	@AfterEach
	public void tearDown() {
		if (service != null) {
			service.stop();
		}
	}

	@Test
	public void theDashboardIsFedTheProjectAndShowsItsProgress() throws Exception {
		List<String> plotIds = new ArrayList<>();
		for (String line : Files.readAllLines(new File(project, "grid/showcase_plots.csv").toPath(), StandardCharsets.UTF_8)) {
			if (!line.startsWith("id,") && !line.trim().isEmpty()) {
				plotIds.add(line.split(",")[0]);
			}
		}
		Map<String, Boolean> saved = new LinkedHashMap<>();
		for (int i = 0; i < 6; i++) {
			saved.put(plotIds.get(i), i < 4); // four submitted, two started
		}
		RecordsSource source = new RecordsSource(new File(project, "grid/showcase_plots.csv"), saved);
		service = new LocalDashboardService(source, new CloudApiClient(), LocalDashboardProcess.SYSTEM_LAUNCHER, node,
				bundle, folder, 60_000, 60_000);
		service.start();
		waitFor(() -> service.getState() == State.READY || service.getState() == State.FAILED, 90_000, "ready");
		assertEquals(State.READY, service.getState(), service.getFailure() + ", log:\n" + log());
		Ready ready = service.getReady();
		assertNotNull(ready);
		assertEquals(LocalDashboardService.projectIdFor(survey.getUri()), ready.getProjectId());

		JsonNode totals = progress(ready).path("totals");
		assertEquals(plotIds.size(), totals.path("plots").asInt(), totals.toString());
		assertEquals(4, totals.path("submitted").asInt(), totals.toString());
		assertEquals(2, totals.path("started").asInt(), totals.toString());

		// A save: the fifth record is submitted, and the dashboard follows within seconds
		saved.put(plotIds.get(4), true);
		service.recordSaved(plotIds.get(4) + ",1");
		waitFor(() -> {
			try {
				return progress(ready).path("totals").path("submitted").asInt() == 5;
			} catch (IOException e) {
				return false;
			}
		}, 10_000, "the save shown");

		// The menu's link opens the dashboard signed in
		String signIn = service.newSignInUrl();
		assertTrue(signIn.startsWith(ready.getBaseUrl() + "/local-sign-in/"), signIn);
		HttpURLConnection page = (HttpURLConnection) new URL(signIn).openConnection();
		assertEquals(200, page.getResponseCode());
		page.disconnect();

		service.stop();
		waitFor(() -> {
			try {
				((HttpURLConnection) new URL(ready.getBaseUrl() + "/v1/server-info").openConnection()).getResponseCode();
				return false;
			} catch (IOException e) {
				return true;
			}
		}, 10_000, "the server stopped");
	}

	@Test
	public void tenThousandRecords() throws Exception {
		assumeTrue("1".equals(System.getenv("DASHBOARD_FEED_10K")), "DASHBOARD_FEED_10K=1 to measure");
		int count = 10_000;
		File csv = new File(project, "grid/plots_10k.csv");
		StringBuilder rows = new StringBuilder("id,round,YCoordinate,XCoordinate,elevation,slope,aspect,climate,soil,gez,country,province,district\n");
		Map<String, Boolean> saved = new LinkedHashMap<>();
		for (int i = 0; i < count; i++) {
			rows.append("p").append(i).append(",1,").append(-10 + i % 100 * 0.2).append(',').append(20 + i / 100 * 0.2)
					.append(",100,5,180,10,7,11,Kenya,Nairobi,not set\n");
			saved.put("p" + i, i % 10 != 0);
		}
		Files.write(csv.toPath(), rows.toString().getBytes(StandardCharsets.UTF_8));
		RecordsSource source = new RecordsSource(csv, saved);
		service = new LocalDashboardService(source, new CloudApiClient(), LocalDashboardProcess.SYSTEM_LAUNCHER, node,
				bundle, folder, 60_000, 600_000);
		long start = System.currentTimeMillis();
		service.start();
		waitFor(() -> service.getState() == State.READY || service.getState() == State.FAILED, 300_000, "ready");
		long total = System.currentTimeMillis() - start;
		assertEquals(State.READY, service.getState(), service.getFailure() + ", log:\n" + log());
		long progressStart = System.currentTimeMillis();
		JsonNode totals = progress(service.getReady()).path("totals");
		long progressMillis = System.currentTimeMillis() - progressStart;
		System.out.println("DASHBOARD 10K: start to ready " + total + " ms, feed " + service.getLastFeedMillis() + " ms for "
				+ service.getLastFeedRecords() + " records, of which " + source.makingNanos / 1_000_000
				+ " ms making and serializing them here, first /progress " + progressMillis
				+ " ms: " + totals);
		assertEquals(count, totals.path("plots").asInt(), totals.toString());
		assertEquals(9000, totals.path("submitted").asInt(), totals.toString());
	}

	private JsonNode progress(Ready ready) throws IOException {
		HttpURLConnection connection = (HttpURLConnection) new URL(
				ready.getBaseUrl() + "/v1/projects/" + ready.getProjectId() + "/progress?tz=UTC").openConnection();
		connection.setRequestProperty("Authorization", "Bearer " + ready.getApiToken());
		try (InputStream in = connection.getInputStream()) {
			return JSON.readTree(in);
		} finally {
			connection.disconnect();
		}
	}

	private String log() {
		try {
			return new String(Files.readAllBytes(new File(folder, LocalDashboardService.LOG_FILE).toPath()), StandardCharsets.UTF_8);
		} catch (IOException e) {
			return "(no log)";
		}
	}

	private static void waitFor(BooleanSupplier condition, long millis, String what) throws InterruptedException {
		long until = System.currentTimeMillis() + millis;
		while (!condition.getAsBoolean()) {
			if (System.currentTimeMillis() > until) {
				throw new AssertionError("Timed out waiting for: " + what);
			}
			Thread.sleep(50);
		}
	}

	/** Records of the demo survey (id, round 1), actively saved or not, made and serialized when loaded. */
	private final class RecordsSource implements DashboardFeedSource {
		private final File plots;
		private final Map<String, Boolean> saved;
		private final List<String> ids;
		private final CloudRecordSerializer serializer = new CloudRecordSerializer();
		volatile long makingNanos;

		RecordsSource(File plots, Map<String, Boolean> saved) {
			this.plots = plots;
			this.saved = saved;
			this.ids = new ArrayList<>(saved.keySet());
		}

		@Override
		public String surveyUri() {
			return survey.getUri();
		}

		@Override
		public String projectName() {
			return "Demo";
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
			List<Integer> list = new ArrayList<>();
			for (int i = 0; i < ids.size(); i++) {
				list.add(i);
			}
			return list;
		}

		@Override
		public RecordEnvelope load(int recordId) throws IOException {
			return envelope(ids.get(recordId));
		}

		@Override
		public RecordEnvelope loadByKey(String recordKey) throws IOException {
			return envelope(recordKey.split(",")[0]);
		}

		private RecordEnvelope envelope(String id) throws IOException {
			long start = System.nanoTime();
			try {
				return make(id);
			} finally {
				makingNanos += System.nanoTime() - start;
			}
		}

		private RecordEnvelope make(String id) throws IOException {
			CollectRecord record = new CollectRecord(survey, null, "plot");
			updater.initializeNewRecord(record);
			updater.updateAttribute((TextAttribute) record.findNodeByPath("plot/id"), new TextValue(id));
			updater.updateAttribute((CodeAttribute) record.findNodeByPath("plot/round"), new Code("1"));
			updater.updateAttribute((TextAttribute) record.findNodeByPath("plot/operator"), new TextValue("Ana María"));
			updater.updateAttribute((BooleanAttribute) record.findNodeByPath("plot/actively_saved"),
					new BooleanValue(Boolean.TRUE.equals(saved.get(id))));
			record.setModifiedDate(new Date());
			record.updateSummaryFields();
			return serializer.serialize(record, id + ",1", survey.getUri());
		}
	}

	/** No code list items from a database: the demo survey's lists are in the survey. */
	private static final class EmptyCodeListService implements CodeListService {
		@Override
		public <T extends CodeListItem> T loadItem(CodeAttribute attribute) {
			return null;
		}

		@Override
		public <T extends CodeListItem> List<T> loadRootItems(CodeList codeList) {
			return Collections.emptyList();
		}

		@Override
		public <T extends CodeListItem> T loadRootItem(CodeList list, String code, ModelVersion version) {
			return null;
		}

		@Override
		public <T extends CodeListItem> List<T> loadChildItems(T parentItem) {
			return Collections.emptyList();
		}

		@Override
		public <T extends CodeListItem> List<T> loadItems(CodeList codeList, int level) {
			return Collections.emptyList();
		}

		@Override
		public boolean hasItems(Entity parent, CodeAttributeDefinition def) {
			return false;
		}

		@Override
		public <T extends CodeListItem> List<T> loadValidItems(Entity parent, CodeAttributeDefinition def) {
			return Collections.emptyList();
		}

		@Override
		public <T extends CodeListItem> T loadParentItem(T item) {
			return null;
		}

		@Override
		public boolean hasQualifiableItems(CodeList codeList) {
			return false;
		}

		@Override
		public <T extends CodeListItem> void save(T item) {
		}

		@Override
		public <T extends CodeListItem> void save(List<T> items) {
		}

		@Override
		public <T extends CodeListItem> void delete(T item) {
		}

		@Override
		public void deleteAllItems(CodeList list) {
		}
	}
}
