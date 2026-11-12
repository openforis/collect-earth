package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.BatchResult;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.CloudApiException;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueItem;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueStatus;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecordSummary;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.stereotype.Component;

/**
 * Background coordinator that keeps the local Collect Earth database in sync with
 * the cloud project of the project open. When it is a cloud project it listens for locally saved records
 * (enqueuing them for upload), drains the durable {@link CloudSyncQueueDao} on a
 * fixed schedule with exponential backoff, and periodically reconciles against the
 * local database to catch records that were saved while sync was off or the
 * listener missed. Only the items of the project open (its survey and its cloud project) are sent, with its server's
 * sign-in; the other projects' wait until they are opened. Signed out of the server, it sends nothing and the records
 * keep queueing. All work happens on a single daemon thread and never surfaces
 * errors to the UI: an offline period simply retries later.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
@Component
public class CloudSyncService implements ApplicationListener<ContextRefreshedEvent> {

	private static final int BATCH_SIZE = 50;
	private static final long SYNC_INTERVAL_SECONDS = 30;
	private static final long RECONCILE_INTERVAL_MINUTES = 10;
	/** A record just saved is sent this long after, together with any saved meanwhile */
	private static final long PUSH_DELAY_SECONDS = 3;
	private static final long BASE_BACKOFF_MS = 30_000L;
	private static final long MAX_BACKOFF_MS = 3_600_000L; // 1 hour

	private static final String STATUS_STORED = "stored";
	private static final String STATUS_STALE = "stale";
	private static final String STATUS_CONFLICT = "conflict";
	/** The notice's kind: the pages read app info again once it is answered, and so ask for the login */
	public static final String SIGNED_OUT_NOTICE = "cloudSignedOut";

	private final Logger logger = LoggerFactory.getLogger(CloudSyncService.class);

	@Autowired
	private EarthSurveyService earthSurveyService;
	@Autowired
	private LocalPropertiesService localPropertiesService;
	@Autowired
	private CloudSyncQueueDao queueDao;
	@Autowired
	private CloudRecordSerializer serializer;
	@Autowired
	private CloudApiClient apiClient;
	@Autowired(required = false)
	private NoticeService notices;
	@Autowired(required = false)
	private CloudPlotLayout plotLayout;

	private final AtomicBoolean started = new AtomicBoolean(false);
	private final ReentrantLock syncLock = new ReentrantLock();
	private final AtomicBoolean pushScheduled = new AtomicBoolean(false);
	private volatile boolean offlineLogged = false;
	/** Whether the last attempt reached the server: null before the first one */
	private volatile Boolean online = null;
	/** The cloud project's name and the account's role were asked for (once a start: CloudService.describe) */
	private volatile boolean projectRefreshed = false;
	/** surveyUri whose definition has been successfully uploaded; null until the first success. */
	private volatile String uploadedSurveyUri = null;
	private ScheduledExecutorService executor;

	@Override
	public void onApplicationEvent(ContextRefreshedEvent event) {
		if (!localPropertiesService.isCloudSyncEnabled()) {
			return;
		}
		if (!started.compareAndSet(false, true)) {
			return; // context can be refreshed more than once; only start once
		}
		earthSurveyService.addRecordSavedListener((recordKeyCsv, record) -> {
			try {
				queueDao.enqueue(recordKeyCsv, surveyUri(), localPropertiesService.getCloudProjectId(), localPropertiesService.getOperator(),
						record.getModifiedDate(), false);
				pushSoon();
			} catch (Exception e) {
				// the listener contract forbids throwing: a missed enqueue is caught by reconcile()
				logger.warn("Failed to enqueue record {} for cloud sync: {}", recordKeyCsv, e.getMessage());
			}
		});

		executor = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
			@Override
			public Thread newThread(Runnable r) {
				Thread thread = new Thread(r, "CollectEarth-cloud-sync");
				thread.setDaemon(true);
				return thread;
			}
		});
		executor.scheduleWithFixedDelay(this::syncCycle, SYNC_INTERVAL_SECONDS, SYNC_INTERVAL_SECONDS,
				TimeUnit.SECONDS);
		executor.scheduleWithFixedDelay(this::reconcile, RECONCILE_INTERVAL_MINUTES, RECONCILE_INTERVAL_MINUTES,
				TimeUnit.MINUTES);
		logger.info("Cloud sync started for project {}", localPropertiesService.getCloudProjectId());
	}

	/** A sync in a few seconds, once for the records saved meanwhile: the form shows them sent soon after the save. */
	private void pushSoon() {
		ScheduledExecutorService local = executor;
		if (local != null && !local.isShutdown() && pushScheduled.compareAndSet(false, true)) {
			local.schedule(() -> {
				pushScheduled.set(false);
				syncCycle();
			}, PUSH_DELAY_SECONDS, TimeUnit.SECONDS);
		}
	}

	/** Uploads a bounded batch of due queue items. Safe to call concurrently: overlapping runs are skipped. */
	void syncCycle() {
		if (!syncLock.tryLock()) {
			return; // another run (scheduled or manual) is already in progress
		}
		try {
			if (earthSurveyService.getCollectSurvey() == null || StringUtils.isBlank(localPropertiesService.getCloudSyncToken())) {
				return; // no survey loaded yet, or signed out of the server: the records wait in the queue
			}
			// The server needs the survey definition (idml) to decode records and build
			// exports. Upload it once per survey, retried every cycle until it succeeds.
			ensureSurveyUploaded();
			refreshProject();
			if (plotLayout != null) {
				plotLayout.checkIfDue(System.currentTimeMillis()); // the coordinator may have changed it on the dashboard
			}

			Date now = new Date();
			List<QueueItem> due = queueDao.takeDue(BATCH_SIZE, now, surveyUri(), localPropertiesService.getCloudProjectId());
			if (due.isEmpty()) {
				return;
			}
			List<RecordEnvelope> envelopes = new ArrayList<>();
			List<QueueItem> batched = new ArrayList<>();
			for (QueueItem item : due) {
				RecordEnvelope envelope;
				try {
					envelope = buildEnvelope(item);
				} catch (Exception e) {
					// a record that cannot be loaded/serialized must not stall the rest
					// of the queue: back it off individually and carry on
					logger.warn("Could not prepare record {} for cloud sync: {}", item.getRecordKey(), e.getMessage());
					queueDao.markFailed(item, e.getMessage(), nextAttempt(now, item.getAttempts()));
					continue;
				}
				if (envelope == null) {
					continue; // record disappeared locally; already marked synced
				}
				envelopes.add(envelope);
				batched.add(item);
			}
			if (envelopes.isEmpty()) {
				return;
			}
			uploadAndApply(envelopes, batched);
		} catch (Exception e) {
			logger.warn("Unexpected error during cloud sync cycle: {}", e.getMessage());
		} finally {
			syncLock.unlock();
		}
	}

	private RecordEnvelope buildEnvelope(QueueItem item) throws IOException {
		if (item.isDeleted()) {
			return CloudRecordSerializer.tombstone(item.getRecordKey(), item.getSurveyUri(), item.getOperator(),
					item.getLocalModifiedOn());
		}
		// The item is the loaded survey's (takeDue): a record that is not there was deleted
		CollectRecord record = earthSurveyService.loadRecord(item.getRecordKey().split(","));
		if (record == null) {
			// record was deleted since it was enqueued: nothing left to upload
			queueDao.markSynced(item, new Date());
			return null;
		}
		return serializer.serialize(record, item.getRecordKey(), item.getSurveyUri());
	}

	private void uploadAndApply(List<RecordEnvelope> envelopes, List<QueueItem> batched) {
		Date now = new Date();
		try {
			List<BatchResult> results = apiClient.uploadRecordsBatch(envelopes);
			offlineLogged = false;
			online = true;
			Map<String, BatchResult> byKey = new HashMap<>();
			for (BatchResult result : results) {
				byKey.put(result.getRecordKey(), result);
			}
			for (QueueItem item : batched) {
				BatchResult result = byKey.get(item.getRecordKey());
				if (result == null) {
					// server said nothing about this record: retry it next cycle with backoff
					queueDao.markFailed(item, "No result returned by server", nextAttempt(now, item.getAttempts()));
					continue;
				}
				applyResult(item, result, now);
			}
		} catch (IOException e) {
			// An HTTP answer is the server reached; anything else (no network, no such host, a timeout) is not
			online = e instanceof CloudApiException;
			if (isSignInRefused(e)) {
				signedOut();
			}
			// whole-batch failure, almost always the network being offline
			if (!offlineLogged) {
				logger.info("Cloud sync is offline, records will be retried: {}", e.getMessage());
				offlineLogged = true;
			} else {
				logger.debug("Cloud sync still offline: {}", e.getMessage());
			}
			for (QueueItem item : batched) {
				queueDao.markFailed(item, e.getMessage(), nextAttempt(now, item.getAttempts()));
			}
		}
	}

	private void applyResult(QueueItem item, BatchResult result, Date now) {
		String status = result.getStatus() == null ? "" : result.getStatus();
		if (STATUS_STORED.equalsIgnoreCase(status) || STATUS_STALE.equalsIgnoreCase(status)) {
			queueDao.markSynced(item, now);
		} else if (STATUS_CONFLICT.equalsIgnoreCase(status)) {
			queueDao.markConflict(item, result.getReason());
		} else {
			queueDao.markFailed(item, result.getReason(), nextAttempt(now, item.getAttempts()));
		}
	}

	/**
	 * Uploads the loaded survey's IDML definition to the cloud project, once per survey.
	 * Idempotent on the server (PUT); retried on later cycles until the first success, so
	 * an offline start still uploads as soon as connectivity returns. A survey change
	 * (different URI) triggers a fresh upload.
	 */
	private void ensureSurveyUploaded() {
		String surveyUri = surveyUri();
		if (surveyUri.equals(uploadedSurveyUri)) {
			return; // already uploaded for the current survey
		}
		String idmlPath = localPropertiesService.getImdFile();
		if (idmlPath == null) {
			return;
		}
		File idmlFile = new File(idmlPath);
		if (!idmlFile.exists()) {
			logger.debug("Survey definition file not found, skipping cloud upload: {}", idmlPath);
			return;
		}
		try {
			apiClient.uploadSurveyDefinition(idmlFile, surveyUri);
			uploadedSurveyUri = surveyUri;
			logger.info("Uploaded survey definition {} to cloud project {}", surveyUri,
					localPropertiesService.getCloudProjectId());
		} catch (IOException e) {
			String message = e.getMessage() == null ? "" : e.getMessage();
			if (message.contains("HTTP 403") || message.contains("HTTP 401")) {
				// This token may not upload the survey (e.g. an operator in a project whose
				// coordinator already published the CEP). That is expected: mark done so we
				// stop retrying every cycle. Record sync is unaffected.
				uploadedSurveyUri = surveyUri;
				logger.debug("Survey upload not permitted for this token; assuming the coordinator manages the survey");
			} else {
				// offline or transient error: leave uploadedSurveyUri unset so the next cycle retries
				logger.debug("Survey definition upload deferred, will retry: {}", message);
			}
		}
	}

	/**
	 * Once a start, as soon as the server answers: the cloud project's name (none for one moved from the single cloud
	 * project of before), the account's role in it and whether it is the server's administrator, which a coordinator
	 * may have changed since.
	 */
	private void refreshProject() {
		CloudBinding binding = localPropertiesService.getCloudBinding();
		if (projectRefreshed || binding == null) {
			return;
		}
		if (CloudService.describe(apiClient, binding, localPropertiesService.getCloudSyncToken())) {
			projectRefreshed = true;
			localPropertiesService.saveCloudBinding(binding);
		}
	}

	/** Scans the local database for records saved since the last watermark and enqueues any that were missed. */
	void reconcile() {
		try {
			if (earthSurveyService.getCollectSurvey() == null) {
				return; // survey not loaded yet
			}
			String surveyUri = surveyUri();
			String cloudProjectId = localPropertiesService.getCloudProjectId();
			Date watermark = queueDao.getReconciliationWatermark(surveyUri, cloudProjectId);
			if (watermark == null) {
				watermark = new Date(0L);
			}
			List<CollectRecordSummary> summaries = earthSurveyService.getRecordSummariesSavedSince(watermark);
			for (CollectRecordSummary summary : summaries) {
				String recordKey = String.join(",", summary.getRootEntityKeyValues());
				queueDao.enqueue(recordKey, surveyUri, cloudProjectId, localPropertiesService.getOperator(),
						summary.getModifiedDate(), false);
			}
			queueDao.setReconciliationWatermark(surveyUri, cloudProjectId, new Date());
		} catch (Exception e) {
			logger.debug("Cloud sync reconciliation skipped: {}", e.getMessage());
		}
	}

	/** Requests an immediate sync run on the background thread. No-op if sync is not running. */
	public void syncNowAsync() {
		ScheduledExecutorService local = executor;
		if (local != null && !local.isShutdown()) {
			local.submit(this::syncCycle);
		}
	}

	/** The queue status of the project open, or an empty snapshot when cloud sync is not running. */
	public QueueStatus getStatusSnapshot() {
		if (!started.get() || earthSurveyService.getCollectSurvey() == null) {
			return new QueueStatus(0, 0, 0, null, null);
		}
		return queueDao.getStatus(surveyUri(), localPropertiesService.getCloudProjectId());
	}

	/** Whether the last attempt reached the server: null when there was none since the start. */
	public Boolean isOnline() {
		return online;
	}

	/** The records of a cloud project, of any survey, not sent yet. */
	public int unsentCount(String cloudProjectId) {
		return queueDao.countUnsent(cloudProjectId);
	}

	/**
	 * Where a record of the project open is: "sent" (the server has it), "pending", "failed" (it is retried), or
	 * "local" when it is not in the queue.
	 */
	public String recordState(String recordKey) {
		if (earthSurveyService.getCollectSurvey() == null) {
			return "local";
		}
		if (earthSurveyService.hasUnsavedChanges(recordKey)) {
			return "pending"; // saved by the form, written (and queued) a moment later by the deferred save
		}
		String status = queueDao.getRecordStatus(recordKey, surveyUri(), localPropertiesService.getCloudProjectId());
		if (CloudSyncQueueDao.STATUS_SYNCED.equals(status)) {
			return "sent";
		} else if (CloudSyncQueueDao.STATUS_PENDING.equals(status)) {
			return "pending";
		} else if (status != null) {
			return "failed";
		}
		return "local";
	}

	/** Runs one final sync then stops the background thread. Safe to call even if sync never started. */
	public void shutdownAndFlush(long timeoutMs) {
		ScheduledExecutorService local = executor;
		if (local == null) {
			return;
		}
		try {
			local.submit(this::syncCycle);
			local.shutdown();
			local.awaitTermination(timeoutMs, TimeUnit.MILLISECONDS);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		} catch (Exception e) {
			logger.debug("Error during cloud sync shutdown: {}", e.getMessage());
		}
	}

	/** The server no longer takes the token: unknown, unused for months, or signed out by a coordinator (HTTP 401). */
	static boolean isSignInRefused(IOException e) {
		String message = e.getMessage();
		return message != null && message.contains("HTTP 401");
	}

	/**
	 * The token is forgotten, so the pages ask for the login again (AppInfoController's cloudLoginNeeded), and the
	 * person is told why. The records stay in the queue and are sent once they have logged in.
	 */
	void signedOut() {
		if (StringUtils.isBlank(localPropertiesService.getCloudSyncToken())) {
			return;
		}
		logger.info("Cloud sync: the server no longer accepts this sign-in; asking for the login again");
		localPropertiesService.saveCloudSyncToken("");
		if (notices != null && !notices.hasPending(SIGNED_OUT_NOTICE)) {
			notices.post(new Notice(SIGNED_OUT_NOTICE, Notice.WARNING, Messages.getString("CloudSync.signedOut.title"),
					Messages.getString("CloudSync.signedOut.message")));
		}
	}

	private Date nextAttempt(Date now, int attempts) {
		long delayMs = BASE_BACKOFF_MS;
		for (int i = 0; i < attempts && delayMs < MAX_BACKOFF_MS; i++) {
			delayMs *= 2;
		}
		return new Date(now.getTime() + Math.min(delayMs, MAX_BACKOFF_MS));
	}

	private String surveyUri() {
		return earthSurveyService.getCollectSurvey().getUri();
	}
}
