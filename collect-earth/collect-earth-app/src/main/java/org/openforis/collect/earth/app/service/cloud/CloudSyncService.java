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

import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.BatchResult;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueItem;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueStatus;
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
 * a cloud project. When cloud sync is enabled it listens for locally saved records
 * (enqueuing them for upload), drains the durable {@link CloudSyncQueueDao} on a
 * fixed schedule with exponential backoff, and periodically reconciles against the
 * local database to catch records that were saved while sync was off or the
 * listener missed. All work happens on a single daemon thread and never surfaces
 * errors to the UI: an offline period simply retries later.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
@Component
public class CloudSyncService implements ApplicationListener<ContextRefreshedEvent> {

	private static final int BATCH_SIZE = 50;
	private static final long SYNC_INTERVAL_SECONDS = 30;
	private static final long RECONCILE_INTERVAL_MINUTES = 10;
	private static final long BASE_BACKOFF_MS = 30_000L;
	private static final long MAX_BACKOFF_MS = 3_600_000L; // 1 hour

	private static final String STATUS_STORED = "stored";
	private static final String STATUS_STALE = "stale";
	private static final String STATUS_CONFLICT = "conflict";

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

	private final AtomicBoolean started = new AtomicBoolean(false);
	private final ReentrantLock syncLock = new ReentrantLock();
	private volatile boolean offlineLogged = false;
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
				queueDao.enqueue(recordKeyCsv, surveyUri(), localPropertiesService.getOperator(),
						record.getModifiedDate(), false);
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

	/** Uploads a bounded batch of due queue items. Safe to call concurrently: overlapping runs are skipped. */
	void syncCycle() {
		if (!syncLock.tryLock()) {
			return; // another run (scheduled or manual) is already in progress
		}
		try {
			// The server needs the survey definition (idml) to decode records and build
			// exports. Upload it once per survey, retried every cycle until it succeeds.
			ensureSurveyUploaded();

			Date now = new Date();
			List<QueueItem> due = queueDao.takeDue(BATCH_SIZE, now);
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
					queueDao.markFailed(item.getRecordKey(), item.getSurveyUri(), e.getMessage(),
							nextAttempt(now, item.getAttempts()));
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
		CollectRecord record = earthSurveyService.loadRecord(item.getRecordKey().split(","));
		if (record == null) {
			// record was deleted since it was enqueued: nothing left to upload
			queueDao.markSynced(item.getRecordKey(), item.getSurveyUri(), new Date());
			return null;
		}
		return serializer.serialize(record, item.getRecordKey(), item.getSurveyUri());
	}

	private void uploadAndApply(List<RecordEnvelope> envelopes, List<QueueItem> batched) {
		Date now = new Date();
		try {
			List<BatchResult> results = apiClient.uploadRecordsBatch(envelopes);
			offlineLogged = false;
			Map<String, BatchResult> byKey = new HashMap<>();
			for (BatchResult result : results) {
				byKey.put(result.getRecordKey(), result);
			}
			for (QueueItem item : batched) {
				BatchResult result = byKey.get(item.getRecordKey());
				if (result == null) {
					// server said nothing about this record: retry it next cycle with backoff
					queueDao.markFailed(item.getRecordKey(), item.getSurveyUri(), "No result returned by server",
							nextAttempt(now, item.getAttempts()));
					continue;
				}
				applyResult(item, result, now);
			}
		} catch (IOException e) {
			// whole-batch failure, almost always the network being offline
			if (!offlineLogged) {
				logger.info("Cloud sync is offline, records will be retried: {}", e.getMessage());
				offlineLogged = true;
			} else {
				logger.debug("Cloud sync still offline: {}", e.getMessage());
			}
			for (QueueItem item : batched) {
				queueDao.markFailed(item.getRecordKey(), item.getSurveyUri(), e.getMessage(),
						nextAttempt(now, item.getAttempts()));
			}
		}
	}

	private void applyResult(QueueItem item, BatchResult result, Date now) {
		String status = result.getStatus() == null ? "" : result.getStatus();
		if (STATUS_STORED.equalsIgnoreCase(status) || STATUS_STALE.equalsIgnoreCase(status)) {
			queueDao.markSynced(item.getRecordKey(), item.getSurveyUri(), now);
		} else if (STATUS_CONFLICT.equalsIgnoreCase(status)) {
			queueDao.markConflict(item.getRecordKey(), item.getSurveyUri(), result.getReason());
		} else {
			queueDao.markFailed(item.getRecordKey(), item.getSurveyUri(), result.getReason(),
					nextAttempt(now, item.getAttempts()));
		}
	}

	/**
	 * Uploads the loaded survey's IDML definition to the cloud project, once per survey.
	 * Idempotent on the server (PUT); retried on later cycles until the first success, so
	 * an offline start still uploads as soon as connectivity returns. A survey change
	 * (different URI) triggers a fresh upload.
	 */
	private void ensureSurveyUploaded() {
		if (earthSurveyService.getCollectSurvey() == null) {
			return; // survey not loaded yet
		}
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

	/** Scans the local database for records saved since the last watermark and enqueues any that were missed. */
	void reconcile() {
		try {
			if (earthSurveyService.getCollectSurvey() == null) {
				return; // survey not loaded yet
			}
			String surveyUri = surveyUri();
			Date watermark = queueDao.getReconciliationWatermark(surveyUri);
			if (watermark == null) {
				watermark = new Date(0L);
			}
			List<CollectRecordSummary> summaries = earthSurveyService.getRecordSummariesSavedSince(watermark);
			for (CollectRecordSummary summary : summaries) {
				String recordKey = String.join(",", summary.getRootEntityKeyValues());
				queueDao.enqueue(recordKey, surveyUri, localPropertiesService.getOperator(),
						summary.getModifiedDate(), false);
			}
			queueDao.setReconciliationWatermark(surveyUri, new Date());
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

	/** Current queue status, or an empty snapshot when cloud sync is not running. */
	public QueueStatus getStatusSnapshot() {
		if (!started.get()) {
			return new QueueStatus(0, 0, 0, null, null);
		}
		return queueDao.getStatus();
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
