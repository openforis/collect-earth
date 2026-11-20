package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.CloudApiException;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.Destination;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.openforis.collect.model.CollectRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The plots a coordinator gave the person to correct (docs/plans/2026-11-20-review-at-scale.md, part C): plots others
 * answered, decided "Correct it in Collect Earth" on the dashboard.
 * <ul>
 * <li>The server is asked at each start and every five minutes (my-corrections); the plots come as a plot file,
 * {@code to-correct.csv}, which the person opens instead of their own plots, as a training set ({@link #open},
 * {@link #close}).</li>
 * <li>A correction is <b>never a record of the local database</b>: the cloud sync, its reconcile and "Send to cloud"
 * would send it as the person's own interpretation of the plot. Each plot's record is kept apart, in memory and as a
 * draft ({@code corrections/<plot>.xml}), started from the first answer (its XML, as the server has it).</li>
 * <li>Submitted, it is sent at once (PUT corrections/:plot); offline, at the next check. The server refuses a plot no
 * longer the person's to correct (409), which is then said and left.</li>
 * </ul>
 */
@Component
public class CorrectionService implements ApplicationListener<ContextRefreshedEvent> {

	/** The notices' kind */
	public static final String NOTICE = "cloudCorrections"; //$NON-NLS-1$
	static final String FILE = "to-correct.csv"; //$NON-NLS-1$
	static final String LIST = "to-correct.json"; //$NON-NLS-1$
	static final String STATE = "to-correct.properties"; //$NON-NLS-1$
	static final String DRAFTS = "corrections"; //$NON-NLS-1$
	/** How long a submit waits for the server before saying the correction is sent later */
	static final long SEND_WAIT_SECONDS = 8;

	/** What a plot's correction is, here */
	public enum State {
		/** Not started */
		NONE,
		/** Changed here, not submitted */
		DRAFT,
		/** Submitted here, not sent yet (offline) */
		PENDING,
		/** On the server */
		SENT,
		/** The server would not take it: no longer the person's to correct */
		REFUSED
	}

	/** What a correction's save did, for the form */
	public static class CorrectionLoadResult extends PlacemarkLoadResult {
		/** The correction's state after the save (State's name) */
		private String correction;
		/** Why the server would not take it */
		private String correctionReason;

		public String getCorrection() {
			return correction;
		}

		public String getCorrectionReason() {
			return correctionReason;
		}

		static CorrectionLoadResult of(PlacemarkLoadResult result, State state, String reason) {
			CorrectionLoadResult out = new CorrectionLoadResult();
			out.setSuccess(result.isSuccess());
			out.setMessage(result.getMessage());
			if (result.getInputFieldInfoByParameterName() != null) {
				out.setInputFieldInfoByParameterName(result.getInputFieldInfoByParameterName());
			}
			out.setDeletedEntityDefName(result.getDeletedEntityDefName());
			out.setCurrentStep(result.getCurrentStep());
			out.setSkipFilled(result.isSkipFilled());
			out.correction = state.name();
			out.correctionReason = reason;
			return out;
		}
	}

	private final Logger logger = LoggerFactory.getLogger(CorrectionService.class);
	private final ObjectMapper json = new ObjectMapper();

	private final LocalPropertiesService properties;
	private final CloudApiClient api;
	private final AbstractEarthSurveyService surveys;
	private final MyPlotsService myPlots;
	private final NoticeService notices;
	private final Runnable reload;
	/** {@code <data folder>/cloud} */
	private final File root;

	/** Guards the checks, which wait for the server; the form's calls take the service's own lock */
	private final Object checking = new Object();
	/** The plots to correct as the server listed them last (from the file at a start, offline), by their placemark id */
	private volatile Map<String, JsonNode> plots = Collections.emptyMap();
	/** The records being corrected, by placemark id */
	private final Map<String, CollectRecord> working = new HashMap<>();
	/** The server has no corrections (an older one): not asked again until the next start */
	private volatile boolean olderServer;
	private volatile boolean started;
	private final ScheduledExecutorService sender = Executors.newSingleThreadScheduledExecutor(r -> {
		Thread t = new Thread(r, "CollectEarth-corrections"); //$NON-NLS-1$
		t.setDaemon(true);
		return t;
	});

	@Autowired
	public CorrectionService(LocalPropertiesService properties, CloudApiClient api, AbstractEarthSurveyService surveys, MyPlotsService myPlots,
			@Autowired(required = false) NoticeService notices) {
		this(properties, api, surveys, myPlots, notices, EarthApp::reloadPlots, new File(FolderFinder.getCollectEarthDataFolder(), "cloud")); //$NON-NLS-1$
	}

	/** For the tests: the reload stood in for, the folder chosen */
	CorrectionService(LocalPropertiesService properties, CloudApiClient api, AbstractEarthSurveyService surveys, MyPlotsService myPlots, NoticeService notices,
			Runnable reload, File root) {
		this.properties = properties;
		this.api = api;
		this.surveys = surveys;
		this.myPlots = myPlots;
		this.notices = notices;
		this.reload = reload;
		this.root = root;
	}

	/** The checks: soon after a start, then every five minutes, in a cloud project */
	@Override
	public void onApplicationEvent(ContextRefreshedEvent event) {
		if (!properties.isCloudSyncEnabled() || started) {
			return;
		}
		started = true;
		long seconds = Math.max(10, Long.getLong(MyPlotsService.CHECK_SECONDS_PROPERTY, MyPlotsService.CHECK_MINUTES * 60));
		sender.scheduleWithFixedDelay(() -> {
			if (!olderServer) {
				check();
			}
		}, 15, seconds, TimeUnit.SECONDS);
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Where they are

	File folder() {
		return new File(root, StringUtils.defaultString(properties.getCloudProjectId()).replaceAll("[^A-Za-z0-9._-]", "_")); //$NON-NLS-1$ //$NON-NLS-2$
	}

	/** The plot file of the plots to correct, in the open cloud project */
	public File file() {
		return new File(folder(), FILE);
	}

	private File draftOf(String placemarkId) {
		return new File(new File(folder(), DRAFTS), hash(placemarkId) + ".xml"); //$NON-NLS-1$
	}

	static String hash(String text) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)); //$NON-NLS-1$
			StringBuilder out = new StringBuilder();
			for (int i = 0; i < 12; i++) {
				out.append(String.format("%02x", digest[i])); //$NON-NLS-1$
			}
			return out.toString();
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}

	/** Whether the person opened their plots to correct (they are the plots file) */
	public boolean isOpen() {
		return properties.isCloudSyncEnabled() && myPlots.onCorrections();
	}

	// ---------------------------------------------------------------------------------------------------------------
	// The checks

	/** Asks the server for the plots to correct, sends the corrections waiting: never throws */
	public void check() {
		synchronized (checking) {
			try {
				if (!properties.isCloudSyncEnabled() || StringUtils.isBlank(properties.getCloudSyncToken())) {
					return;
				}
				Destination destination = api.cloudDestination();
				int before = toCorrect();
				boolean changed = update(destination);
				sendPending(destination);
				afterChange(changed, before);
			} catch (IOException | RuntimeException e) {
				logger.warn("The plots to correct could not be brought up to date: {}", e.getMessage()); //$NON-NLS-1$
			}
		}
	}

	/** Asks the server; true when the list or the plot file changed */
	private boolean update(Destination destination) throws IOException {
		File folder = folder();
		Properties state = readState();
		for (int attempt = 0; attempt < 2; attempt++) {
			JsonNode answer;
			try {
				answer = api.myCorrections(destination);
			} catch (CloudApiException e) {
				if (e.getStatus() == 404) {
					olderServer = true;
				}
				loadListed();
				return false;
			} catch (IOException e) {
				loadListed();
				return false;
			}
			String version = answer.path("version").asText(""); //$NON-NLS-1$ //$NON-NLS-2$
			JsonNode listed = answer.path("plots"); //$NON-NLS-1$
			if (version.equals(state.getProperty("version")) && (listed.size() == 0 || file().isFile())) { //$NON-NLS-1$
				if (plots.isEmpty() && listed.size() > 0) {
					remember(listed);
				}
				return false;
			}
			if (!folder.isDirectory() && !folder.mkdirs()) {
				throw new IOException("Could not make the folder of the plots to correct " + folder); //$NON-NLS-1$
			}
			if (listed.size() > 0) {
				try {
					api.downloadMyCorrections(destination, answer.path("downloadPath").asText(), file()); //$NON-NLS-1$
				} catch (CloudApiException e) {
					if (e.getStatus() == 409 && attempt == 0) {
						continue; // changed since it was listed
					}
					loadListed();
					return false;
				}
			}
			File list = new File(folder, LIST);
			File temp = new File(folder, LIST + ".tmp"); //$NON-NLS-1$
			json.writeValue(temp, listed);
			Files.move(temp.toPath(), list.toPath(), StandardCopyOption.REPLACE_EXISTING);
			state.setProperty("version", version); //$NON-NLS-1$
			state.setProperty("keyColumns", answer.path("keyColumns").asText("1")); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			writeState(state);
			remember(listed);
			logger.info("The plots to correct were downloaded: {} plots", listed.size()); //$NON-NLS-1$
			return true;
		}
		return false;
	}

	/** Offline: the list of the last check, once */
	private void loadListed() {
		if (!plots.isEmpty()) {
			return;
		}
		File list = new File(folder(), LIST);
		if (list.isFile()) {
			try {
				remember(json.readTree(list));
			} catch (IOException e) {
				logger.warn("The list of the plots to correct could not be read: {}", e.getMessage()); //$NON-NLS-1$
			}
		}
	}

	private synchronized void remember(JsonNode listed) {
		Map<String, JsonNode> byId = new LinkedHashMap<>();
		for (JsonNode plot : listed) {
			String id = plot.path("placemarkId").asText(plot.path("plot").asText()); //$NON-NLS-1$ //$NON-NLS-2$
			if (!id.isEmpty()) {
				byId.put(id, plot);
			}
		}
		plots = byId;
		working.keySet().retainAll(byId.keySet());
	}

	/** What follows a check: the plots reloaded when the open list changed, back to the person's plots when none is left */
	private void afterChange(boolean changed, int before) {
		boolean open = isOpen();
		int now = toCorrect();
		if (open && plots.isEmpty()) {
			myPlots.useMyPlots();
			say(Notice.OK, Messages.getString("Corrections.allDone")); //$NON-NLS-1$
			return;
		}
		if (open && changed) {
			reload.run();
		}
		if (!open && now > before && now > 0) {
			say(Notice.INFO, Messages.getString("Corrections.waiting").replace("{0}", String.valueOf(now))); //$NON-NLS-1$ //$NON-NLS-2$
		}
	}

	private void say(String severity, String message) {
		if (notices != null) {
			notices.post(new Notice(NOTICE, severity, Messages.getString("Corrections.title"), message)); //$NON-NLS-1$
		}
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Opening them

	/** The plots to correct made the plots file; false when there are none */
	public boolean open() {
		loadListed();
		File file = file();
		if (plots.isEmpty() || !file.isFile()) {
			return false;
		}
		myPlots.openCorrections(file);
		reload.run();
		return true;
	}

	/** Back to the person's plots */
	public boolean close() {
		return myPlots.useMyPlots();
	}

	/** How many plots are left to correct (not corrected on the server nor submitted here) */
	public int toCorrect() {
		Properties state = readState();
		int n = 0;
		for (Map.Entry<String, JsonNode> plot : plots.entrySet()) {
			State s = stateOf(plot.getKey(), plot.getValue(), state);
			if (s != State.SENT && s != State.PENDING) {
				n++;
			}
		}
		return n;
	}

	/** What the plots map and the Project menu show: how many, whether they are open */
	public Map<String, Object> status() {
		loadListed();
		Map<String, Object> status = new LinkedHashMap<>();
		status.put("plots", plots.size()); //$NON-NLS-1$
		status.put("toCorrect", toCorrect()); //$NON-NLS-1$
		status.put("open", isOpen()); //$NON-NLS-1$
		status.put("available", properties.isCloudSyncEnabled() && !olderServer); //$NON-NLS-1$
		return status;
	}

	/** Each plot's status for the plots map, as the statuses of records are named there (saved, partial, empty) */
	public Map<String, String> statuses() {
		Properties state = readState();
		Map<String, String> out = new LinkedHashMap<>();
		for (Map.Entry<String, JsonNode> plot : plots.entrySet()) {
			State s = stateOf(plot.getKey(), plot.getValue(), state);
			out.put(plot.getKey(), s == State.SENT || s == State.PENDING ? "saved" : s == State.NONE ? "empty" : "partial"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		}
		return out;
	}

	private State stateOf(String placemarkId, JsonNode plot, Properties state) {
		String here = state.getProperty("state." + placemarkId); //$NON-NLS-1$
		if (State.PENDING.name().equals(here)) {
			return State.PENDING;
		}
		if (State.REFUSED.name().equals(here)) {
			return State.REFUSED;
		}
		if (!plot.path("correctedAt").isNull() && !plot.path("correctedAt").isMissingNode() //$NON-NLS-1$ //$NON-NLS-2$
				|| State.SENT.name().equals(here)) {
			// sent here, or on the server (from another computer): a draft changed after it is a draft again
			return State.DRAFT.name().equals(here) ? State.DRAFT : State.SENT;
		}
		return State.DRAFT.name().equals(here) || draftOf(placemarkId).isFile() ? State.DRAFT : State.NONE;
	}

	/**
	 * One plot for the panel beside the form: the reviewer's comment and who decided, whether the person answered it, its
	 * answers (without their XML) and where they differ, and its state here. Null for a plot not to correct.
	 */
	public Map<String, Object> plotInfo(String placemarkId) {
		loadListed();
		JsonNode plot = plots.get(placemarkId);
		if (plot == null) {
			return null;
		}
		ObjectNode copy = plot.deepCopy();
		for (JsonNode answer : copy.path("answers")) { //$NON-NLS-1$
			((ObjectNode) answer).remove("xml"); //$NON-NLS-1$
		}
		@SuppressWarnings("unchecked")
		Map<String, Object> info = json.convertValue(copy, LinkedHashMap.class);
		info.put("state", stateOf(placemarkId, plot, readState()).name()); //$NON-NLS-1$
		info.put("reason", readState().getProperty("reason." + placemarkId)); //$NON-NLS-1$ //$NON-NLS-2$
		return info;
	}

	// ---------------------------------------------------------------------------------------------------------------
	// The form

	/** The record a plot's form shows: the draft, else the first answer; not found (success false) when there is neither */
	public synchronized PlacemarkLoadResult load(String placemarkId) {
		CollectRecord record = recordOf(placemarkId);
		if (record == null) {
			PlacemarkLoadResult result = new PlacemarkLoadResult();
			result.setSuccess(false);
			result.setMessage("Nothing to start from"); //$NON-NLS-1$
			return result;
		}
		return surveys.loadDetachedRecord(record);
	}

	/** The form's values applied to the plot's record, kept as a draft; submitted and complete, the correction is sent */
	public CorrectionLoadResult save(String placemarkId, Map<String, String> values, boolean partial) {
		JsonNode plot = plots.get(placemarkId);
		if (plot == null) {
			return refused(placemarkId);
		}
		PlacemarkLoadResult result;
		CollectRecord record;
		synchronized (this) {
			record = recordOf(placemarkId);
			if (record == null) {
				record = surveys.newDetachedRecord(placemarkId.split(","), values); //$NON-NLS-1$
				working.put(placemarkId, record);
			}
			result = surveys.updateDetachedRecord(record, values, partial);
			if (!result.isSuccess()) {
				return CorrectionLoadResult.of(result, State.DRAFT, null);
			}
			try {
				writeDraft(placemarkId, record);
			} catch (IOException e) {
				logger.warn("The correction of {} could not be kept as a draft: {}", placemarkId, e.getMessage()); //$NON-NLS-1$
			}
		}
		// actively saved only when submitted and complete, as the form reads it (AbstractEarthSurveyService)
		if (!result.isActivelySaved()) {
			setState(placemarkId, State.DRAFT, null);
			return CorrectionLoadResult.of(result, State.DRAFT, null);
		}
		setState(placemarkId, State.PENDING, null);
		State sent = sendSoon(placemarkId);
		Properties state = readState();
		return CorrectionLoadResult.of(result, sent, state.getProperty("reason." + placemarkId)); //$NON-NLS-1$
	}

	public synchronized PlacemarkLoadResult addEntity(String placemarkId, String entityName, Map<String, String> values) {
		CollectRecord record = recordOf(placemarkId);
		if (record == null) {
			if (!plots.containsKey(placemarkId)) {
				return refused(placemarkId);
			}
			record = surveys.newDetachedRecord(placemarkId.split(","), values); //$NON-NLS-1$
			working.put(placemarkId, record);
		}
		return keptAfter(placemarkId, record, surveys.addEntityToDetachedRecord(record, entityName));
	}

	public synchronized PlacemarkLoadResult deleteEntity(String placemarkId, String entityName) {
		CollectRecord record = recordOf(placemarkId);
		if (record == null) {
			return refused(placemarkId);
		}
		return keptAfter(placemarkId, record, surveys.deleteEntityOfDetachedRecord(record, entityName));
	}

	private PlacemarkLoadResult keptAfter(String placemarkId, CollectRecord record, PlacemarkLoadResult result) {
		if (result.isSuccess()) {
			try {
				writeDraft(placemarkId, record);
			} catch (IOException e) {
				logger.warn("The correction of {} could not be kept as a draft: {}", placemarkId, e.getMessage()); //$NON-NLS-1$
			}
			setState(placemarkId, State.DRAFT, null);
		}
		return result;
	}

	private CorrectionLoadResult refused(String placemarkId) {
		PlacemarkLoadResult result = new PlacemarkLoadResult();
		result.setSuccess(false);
		result.setMessage(Messages.getString("Corrections.notListed")); //$NON-NLS-1$
		logger.info("A correction of {}, which is not to correct, was refused", placemarkId); //$NON-NLS-1$
		return CorrectionLoadResult.of(result, State.REFUSED, null);
	}

	/** The plot's record kept apart: in memory, else its draft, else the first answer (made the correction's start) */
	private CollectRecord recordOf(String placemarkId) {
		CollectRecord record = working.get(placemarkId);
		if (record != null) {
			return record;
		}
		JsonNode plot = plots.get(placemarkId);
		if (plot == null) {
			return null;
		}
		File draft = draftOf(placemarkId);
		if (draft.isFile()) {
			try {
				record = surveys.parseDetachedRecord(new String(Files.readAllBytes(draft.toPath()), StandardCharsets.UTF_8));
			} catch (IOException e) {
				logger.warn("The draft of the correction of {} could not be read: {}", placemarkId, e.getMessage()); //$NON-NLS-1$
			}
		}
		if (record == null) {
			for (JsonNode answer : plot.path("answers")) { //$NON-NLS-1$
				String xml = answer.path("xml").asText(""); //$NON-NLS-1$ //$NON-NLS-2$
				record = xml.isEmpty() ? null : surveys.parseDetachedRecord(xml);
				if (record != null) {
					surveys.startDetachedRecord(record);
					Properties state = readState();
					state.setProperty("base." + placemarkId, answer.path("operator").asText("")); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					writeState(state);
					break;
				}
			}
		}
		if (record != null) {
			working.put(placemarkId, record);
		}
		return record;
	}

	private void writeDraft(String placemarkId, CollectRecord record) throws IOException {
		File draft = draftOf(placemarkId);
		File folder = draft.getParentFile();
		if (!folder.isDirectory() && !folder.mkdirs()) {
			throw new IOException("Could not make the folder of the corrections " + folder); //$NON-NLS-1$
		}
		File temp = new File(folder, draft.getName() + ".tmp"); //$NON-NLS-1$
		Files.write(temp.toPath(), surveys.detachedRecordXml(record).getBytes(StandardCharsets.UTF_8));
		Files.move(temp.toPath(), draft.toPath(), StandardCopyOption.REPLACE_EXISTING);
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Sending them

	/** Sends a correction just submitted, waiting a few seconds for the server: PENDING when it did not answer in time */
	private State sendSoon(String placemarkId) {
		Future<State> sending = sender.submit(() -> {
			synchronized (checking) {
				return send(api.cloudDestination(), placemarkId);
			}
		});
		try {
			return sending.get(SEND_WAIT_SECONDS, TimeUnit.SECONDS);
		} catch (TimeoutException e) {
			return State.PENDING;
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			return State.PENDING;
		} catch (ExecutionException e) {
			logger.warn("The correction of {} could not be sent: {}", placemarkId, e.getMessage()); //$NON-NLS-1$
			return State.PENDING;
		}
	}

	/** The corrections submitted here and not sent yet */
	private void sendPending(Destination destination) {
		Properties state = readState();
		List<String> pending = new ArrayList<>();
		for (String name : state.stringPropertyNames()) {
			if (name.startsWith("state.") && State.PENDING.name().equals(state.getProperty(name))) { //$NON-NLS-1$
				pending.add(name.substring("state.".length())); //$NON-NLS-1$
			}
		}
		for (Iterator<String> it = pending.iterator(); it.hasNext();) {
			if (send(destination, it.next()) == State.PENDING) {
				return; // offline: the next check
			}
		}
	}

	/** Sends one correction: SENT, REFUSED (said why), or PENDING (to send again) */
	private State send(Destination destination, String placemarkId) {
		JsonNode plot = plots.get(placemarkId);
		CollectRecord record;
		String xml;
		Map<String, String> summary;
		synchronized (this) {
			record = recordOf(placemarkId);
			if (plot == null || record == null) {
				setState(placemarkId, State.REFUSED, Messages.getString("Corrections.notListed")); //$NON-NLS-1$
				return State.REFUSED;
			}
			try {
				xml = surveys.detachedRecordXml(record);
			} catch (IOException e) {
				logger.warn("The correction of {} could not be written: {}", placemarkId, e.getMessage()); //$NON-NLS-1$
				return State.PENDING;
			}
			summary = surveys.detachedRecordSummary(record);
		}
		List<String> keys = record.getRootEntityKeyValues();
		String recordKey = keys == null || keys.isEmpty() ? placemarkId : String.join(",", keys); //$NON-NLS-1$
		String base = StringUtils.trimToNull(readState().getProperty("base." + placemarkId)); //$NON-NLS-1$
		try {
			api.putCorrection(destination, plot.path("plot").asText(), recordKey, xml, summary, base); //$NON-NLS-1$
			setState(placemarkId, State.SENT, null);
			logger.info("The correction of {} was sent", placemarkId); //$NON-NLS-1$
			return State.SENT;
		} catch (CloudApiException e) {
			if (e.getStatus() == 409 || e.getStatus() == 403 || e.getStatus() == 400) {
				String reason = Messages.getString("not_assigned".equals(e.getErrorCode()) ? "Corrections.notAssigned" //$NON-NLS-1$ //$NON-NLS-2$
						: "not_to_correct".equals(e.getErrorCode()) ? "Corrections.notToCorrect" : "Corrections.refused"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
				setState(placemarkId, State.REFUSED, reason);
				say(Notice.WARNING, reason);
				return State.REFUSED;
			}
			return State.PENDING;
		} catch (IOException | RuntimeException e) {
			logger.info("The correction of {} is sent later: {}", placemarkId, e.getMessage()); //$NON-NLS-1$
			return State.PENDING;
		}
	}

	// ---------------------------------------------------------------------------------------------------------------
	// The state kept

	private synchronized Properties readState() {
		Properties state = new Properties();
		File file = new File(folder(), STATE);
		if (file.isFile()) {
			try (java.io.Reader in = Files.newBufferedReader(file.toPath(), StandardCharsets.UTF_8)) {
				state.load(in);
			} catch (IOException e) {
				logger.warn("The state of the plots to correct could not be read: {}", e.getMessage()); //$NON-NLS-1$
			}
		}
		return state;
	}

	private synchronized void writeState(Properties state) {
		File folder = folder();
		if (!folder.isDirectory() && !folder.mkdirs()) {
			logger.warn("Could not make the folder of the plots to correct {}", folder); //$NON-NLS-1$
			return;
		}
		File file = new File(folder, STATE);
		File temp = new File(folder, STATE + ".tmp"); //$NON-NLS-1$
		try (java.io.Writer out = Files.newBufferedWriter(temp.toPath(), StandardCharsets.UTF_8)) {
			state.store(out, null);
		} catch (IOException e) {
			logger.warn("The state of the plots to correct could not be written: {}", e.getMessage()); //$NON-NLS-1$
			return;
		}
		try {
			Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
		} catch (IOException e) {
			logger.warn("The state of the plots to correct could not be written: {}", e.getMessage()); //$NON-NLS-1$
		}
	}

	private synchronized void setState(String placemarkId, State value, String reason) {
		Properties state = readState();
		state.setProperty("state." + placemarkId, value.name()); //$NON-NLS-1$
		if (reason == null) {
			state.remove("reason." + placemarkId); //$NON-NLS-1$
		} else {
			state.setProperty("reason." + placemarkId, reason); //$NON-NLS-1$
		}
		writeState(state);
	}

	/** For the tests */
	boolean isOlderServer() {
		return olderServer;
	}
}
