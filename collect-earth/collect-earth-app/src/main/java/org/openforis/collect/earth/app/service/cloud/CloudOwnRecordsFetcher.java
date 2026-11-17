package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.IntPredicate;

import org.apache.commons.io.FileUtils;
import org.apache.commons.io.IOUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.OwnRecords;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.io.data.DataImportSummary;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.stereotype.Component;

/**
 * Brings the account's own records of the cloud project to this computer: someone whose earlier work reached the cloud
 * another way (an office's database brought in from its backup, a coordinator giving them a typed name's plots,
 * another computer) finds their plots on this one as they left them, instead of empty forms they would do again
 * (docs/plans/2026-11-15-workflow-review.md). At the first start after joining or opening the project; then, at each
 * start and every ten minutes while it runs, when the server has records of the account this computer has none of, or
 * newer saves of some (one small request: their keys and when each was saved), those records only.
 * <p>
 * Plots this computer has no record of are added; one it has is replaced only by a newer save of the person's (made on
 * their other computer), and never while it has changes here not sent yet; a record here under another name is never
 * replaced (a colleague's, on a computer several people collected on). The records brought are not sent back as new
 * work. A failure keeps the request for the next start.
 */
@Component
public class CloudOwnRecordsFetcher implements ApplicationListener<ContextRefreshedEvent> {

	/** The notice's kind */
	public static final String NOTICE = "cloudOwnRecords";
	/** How long the start may take to load the survey before the records are brought */
	private static final long SURVEY_WAIT_MS = 120_000;

	private final Logger logger = LoggerFactory.getLogger(CloudOwnRecordsFetcher.class);

	private final LocalPropertiesService properties;
	private final CloudApiClient api;
	private final DataImportExportService data;
	private final EarthSurveyService surveys;
	private final NoticeService notices;
	private final Runnable reload;

	@Autowired
	public CloudOwnRecordsFetcher(LocalPropertiesService properties, CloudApiClient api, DataImportExportService data, EarthSurveyService surveys,
			@Autowired(required = false) NoticeService notices) {
		this(properties, api, data, surveys, notices, EarthApp::reloadPlots);
	}

	/** Whether a plot has changes here not sent yet (absent in some tests) */
	private CloudSyncService sync;

	@Autowired(required = false)
	public void setSync(CloudSyncService sync) {
		this.sync = sync;
	}

	/**
	 * Whether the record here with that id is the person's (their username, or a name typed here before the join): a
	 * colleague's copy of a plot, on a computer several people collected on, is never replaced by the person's newer
	 * save. Every record counts as theirs without the sender (some tests).
	 */
	private IntPredicate mineHere = id -> true;

	@Autowired(required = false)
	public void setSender(CloudRecordsSender sender) {
		this.mineHere = sender::isMineHere;
	}

	/** For the tests */
	void setMineHere(IntPredicate mineHere) {
		this.mineHere = mineHere;
	}

	/** For the tests: the reload of the plots stood in for. */
	CloudOwnRecordsFetcher(LocalPropertiesService properties, CloudApiClient api, DataImportExportService data, EarthSurveyService surveys,
			NoticeService notices, Runnable reload) {
		this.properties = properties;
		this.api = api;
		this.data = data;
		this.surveys = surveys;
		this.notices = notices;
		this.reload = reload;
	}

	/** Asked for by joining or opening a cloud project (CloudService), done at the next start. */
	public static void requestAtNextStart(LocalPropertiesService properties) {
		properties.setValue(EarthProperty.CLOUD_FETCH_OWN_RECORDS, Boolean.TRUE.toString());
	}

	@Override
	public void onApplicationEvent(ContextRefreshedEvent event) {
		if (!properties.isCloudSyncEnabled() || started) {
			return;
		}
		started = true;
		boolean asked = Boolean.parseBoolean(properties.getValue(EarthProperty.CLOUD_FETCH_OWN_RECORDS));
		if (asked) {
			properties.setValue(EarthProperty.CLOUD_FETCH_OWN_RECORDS, ""); // once (a failure asks again)
		}
		// One thread: at the start (once the survey is loaded), then every CHECK_MINUTES while Collect Earth runs, so plots
		// a coordinator gives meanwhile (a typed name's, People > Names typed in Collect Earth) come without a restart
		ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(r -> {
			Thread t = new Thread(r, "CollectEarth-own-cloud-records"); //$NON-NLS-1$
			t.setDaemon(true);
			return t;
		});
		executor.execute(() -> {
			if (!waitForSurvey()) {
				if (asked) {
					requestAtNextStart(properties);
				}
				return;
			}
			if (asked) {
				fetch(false);
			} else {
				Set<String> wanted = keysToFetch();
				if (!wanted.isEmpty()) {
					fetch(false, wanted);
				}
			}
		});
		executor.scheduleWithFixedDelay(this::check, CHECK_MINUTES, CHECK_MINUTES, TimeUnit.MINUTES);
	}

	/** How often the server is asked whether it has more of the account's records than this computer */
	static final long CHECK_MINUTES = 10;

	/**
	 * The check every CHECK_MINUTES: quiet when there is nothing, offline, or no longer in a cloud project. Only the
	 * records this computer lacks or has an older copy of are downloaded: a computer left open beside the one the person
	 * works on gets the few plots saved meanwhile, not all of theirs every ten minutes.
	 */
	void check() {
		if (properties.isCloudSyncEnabled() && surveys.getCollectSurvey() != null) {
			Set<String> wanted = keysToFetch();
			if (!wanted.isEmpty()) {
				fetch(true, wanted);
			}
		}
	}

	/** The context refreshes more than once at a start (the root and the servlet's): one check per start */
	private volatile boolean started;

	/**
	 * How much later than this computer's copy the server's must be saved to count as newer (the two clocks and their
	 * rounding): a second.
	 */
	static final long NEWER_MS = 1000;

	/** The plot has changes here not sent yet (the form's, or queued): never replaced by the cloud's copy */
	private boolean unsentHere(String recordKey) {
		if (sync == null) {
			return false;
		}
		String state = sync.recordState(recordKey);
		return "pending".equals(state) || "failed".equals(state); //$NON-NLS-1$ //$NON-NLS-2$
	}

	/**
	 * Whether the server has records of the account this computer has none of, or a newer save of one it has (made on the
	 * person's other computer) with nothing unsent here. A record here under another name (a colleague's copy) counts as
	 * there: it is never replaced. Quietly false offline.
	 */
	boolean serverHasMore() {
		return !keysToFetch().isEmpty();
	}

	/** The keys of the records {@link #serverHasMore()} is about: none offline */
	Set<String> keysToFetch() {
		Set<String> wanted = new LinkedHashSet<>();
		try {
			Map<String, Long> there = api.ownRecordKeys(api.cloudDestination());
			if (there.isEmpty()) {
				return wanted;
			}
			Map<String, CollectRecordSummary> here = new HashMap<>();
			for (CollectRecordSummary summary : surveys.getRecordSummariesSavedSince(new Date(0))) {
				here.put(String.join(",", summary.getRootEntityKeyValues()), summary);
			}
			for (Map.Entry<String, Long> e : there.entrySet()) {
				CollectRecordSummary mine = here.get(e.getKey());
				if (mine == null || (e.getValue() > modifiedAt(mine) + NEWER_MS && replaceable(e.getKey(), mine))) {
					wanted.add(e.getKey());
				}
			}
		} catch (Exception e) {
			logger.debug("Could not ask the cloud project which of the account's records it has: {}", e.getMessage()); //$NON-NLS-1$
			wanted.clear();
		}
		return wanted;
	}

	private boolean waitForSurvey() {
		long until = System.currentTimeMillis() + SURVEY_WAIT_MS;
		while (surveys.getCollectSurvey() == null) {
			if (System.currentTimeMillis() > until) {
				return false;
			}
			try {
				Thread.sleep(500);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				return false;
			}
		}
		return true;
	}

	/** {@link #fetch(boolean)} as at the start: a failure is said */
	int fetch() {
		return fetch(false);
	}

	/**
	 * Brings them: how many plots were added to this computer (-1 when it failed, and is asked again for the next start).
	 * The check every few minutes ({@code quiet}) does not say a failure: it tries again at the next check.
	 */
	synchronized int fetch(boolean quiet) {
		return fetch(quiet, null);
	}

	/** {@link #fetch(boolean)}, only the records of those keys (all of them when null) */
	synchronized int fetch(boolean quiet, Set<String> keys) {
		File file = null;
		XMLDataImportProcess process = null;
		try {
			OwnRecords own = keys == null ? api.downloadOwnRecords(api.cloudDestination()) : api.downloadOwnRecords(api.cloudDestination(), keys);
			file = own.getFile();
			if (own.getCount() == 0) {
				return 0;
			}
			surveys.flushAndForgetWorkingRecords();
			// The drafts too: they are the person's plots as they left them
			process = data.getImportSummary(file, true);
			process.call();
			DataImportSummary summary = process.getSummary();
			int toImport = summary == null || summary.getRecordsToImport() == null ? 0 : summary.getRecordsToImport().size();
			// A plot this computer has is replaced only by a newer save (made on the person's other computer), and never
			// while it has changes here not sent yet
			List<DataImportSummaryItem> newer = new ArrayList<>();
			if (summary != null && summary.getConflictingRecords() != null) {
				for (DataImportSummaryItem item : summary.getConflictingRecords()) {
					if (isNewerThere(item)) {
						newer.add(item);
					}
				}
			}
			if (toImport == 0 && newer.isEmpty()) {
				return 0;
			}
			data.importRecordsFrom(file, process, newer);
			toImport += newer.size();
			surveys.flushAndForgetWorkingRecords();
			reload.run();
			logger.info("Brought {} of the account's own records from the cloud project to this computer", toImport); //$NON-NLS-1$
			notify(Notice.INFO, MessageFormat.format(Messages.getString("CloudFetch.done"), toImport)); //$NON-NLS-1$
			return toImport;
		} catch (Exception e) {
			logger.warn("The account's own records could not be brought from the cloud project: {}", e.getMessage()); //$NON-NLS-1$
			requestAtNextStart(properties);
			if (!quiet) {
				notify(Notice.WARNING, MessageFormat.format(Messages.getString("CloudFetch.failed"), String.valueOf(e.getMessage()))); //$NON-NLS-1$
			}
			return -1;
		} finally {
			IOUtils.closeQuietly(process);
			if (file != null) {
				FileUtils.deleteQuietly(file);
			}
		}
	}

	/** The cloud's copy of a plot this computer has is newer, and the copy here may be replaced by it */
	private boolean isNewerThere(DataImportSummaryItem item) {
		CollectRecordSummary there = item.getRecordSummary();
		CollectRecordSummary here = item.getConflictingRecordSummary();
		if (there == null || here == null || there.getModifiedDate() == null) {
			return false;
		}
		if (there.getModifiedDate().getTime() <= modifiedAt(here) + NEWER_MS) {
			return false;
		}
		List<String> keys = there.getRootEntityKeyValues();
		return keys != null && replaceable(String.join(",", keys), here);
	}

	/** A copy here may be replaced by the person's newer save: it is theirs, and nothing of it waits to be sent */
	private boolean replaceable(String recordKey, CollectRecordSummary here) {
		return !unsentHere(recordKey) && (here.getId() == null || mineHere.test(here.getId()));
	}

	private static long modifiedAt(CollectRecordSummary summary) {
		return summary.getModifiedDate() == null ? 0L : summary.getModifiedDate().getTime();
	}

	private void notify(String severity, String message) {
		if (notices != null) {
			notices.post(new Notice(NOTICE, severity, Messages.getString("CloudFetch.title"), message)); //$NON-NLS-1$
		}
	}
}
