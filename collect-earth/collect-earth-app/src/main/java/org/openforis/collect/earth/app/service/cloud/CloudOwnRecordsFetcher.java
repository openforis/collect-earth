package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.text.MessageFormat;
import java.util.Collections;

import org.apache.commons.io.FileUtils;
import org.apache.commons.io.IOUtils;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.OwnRecords;
import org.openforis.collect.earth.app.service.dashboard.DashboardFeedSource;
import org.openforis.collect.earth.app.service.dashboard.EarthDashboardFeedSource;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.io.data.DataImportSummary;
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
 * (docs/plans/2026-11-15-workflow-review.md). At the first start after joining or opening the project; then at each
 * start, when the server has more of the account's records than this computer has of the project (one small request).
 * <p>
 * Only plots this computer has no record of are added: a record here is never replaced (it may not be sent yet). The
 * records added are not sent back: they are the cloud's, and the sync only queues what is saved here. A failure keeps
 * the request for the next start.
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
	private final DashboardFeedSource local;
	private final NoticeService notices;
	private final Runnable reload;

	@Autowired
	public CloudOwnRecordsFetcher(LocalPropertiesService properties, CloudApiClient api, DataImportExportService data, EarthSurveyService surveys,
			EarthDashboardFeedSource local, @Autowired(required = false) NoticeService notices) {
		this(properties, api, data, surveys, local, notices, EarthApp::reloadPlots);
	}

	/** For the tests: the reload of the plots stood in for. */
	CloudOwnRecordsFetcher(LocalPropertiesService properties, CloudApiClient api, DataImportExportService data, EarthSurveyService surveys,
			DashboardFeedSource local, NoticeService notices, Runnable reload) {
		this.properties = properties;
		this.api = api;
		this.data = data;
		this.surveys = surveys;
		this.local = local;
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
		Thread thread = new Thread(() -> {
			if (!waitForSurvey()) {
				if (asked) {
					requestAtNextStart(properties);
				}
				return;
			}
			if (asked || serverHasMore()) {
				fetch();
			}
		}, "CollectEarth-own-cloud-records"); //$NON-NLS-1$
		thread.setDaemon(true);
		thread.start();
	}

	/** The context refreshes more than once at a start (the root and the servlet's): one check per start */
	private volatile boolean started;

	/** Whether the server has more of the account's records than this computer has of the project (quietly false offline) */
	boolean serverHasMore() {
		try {
			int there = api.ownRecordsCount(api.cloudDestination());
			int here = local.recordIds().size();
			return there > here;
		} catch (Exception e) {
			logger.debug("Could not ask the cloud project how many of the account's records it has: {}", e.getMessage()); //$NON-NLS-1$
			return false;
		}
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

	/** Brings them: how many plots were added to this computer (-1 when it failed, and is asked again for the next start) */
	int fetch() {
		File file = null;
		XMLDataImportProcess process = null;
		try {
			OwnRecords own = api.downloadOwnRecords(api.cloudDestination());
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
			if (toImport == 0) {
				return 0;
			}
			// No conflicting record: those this computer has stay as they are
			data.importRecordsFrom(file, process, Collections.emptyList());
			surveys.flushAndForgetWorkingRecords();
			reload.run();
			logger.info("Brought {} of the account's own records from the cloud project to this computer", toImport); //$NON-NLS-1$
			notify(Notice.INFO, MessageFormat.format(Messages.getString("CloudFetch.done"), toImport)); //$NON-NLS-1$
			return toImport;
		} catch (Exception e) {
			logger.warn("The account's own records could not be brought from the cloud project: {}", e.getMessage()); //$NON-NLS-1$
			requestAtNextStart(properties);
			notify(Notice.WARNING, MessageFormat.format(Messages.getString("CloudFetch.failed"), String.valueOf(e.getMessage()))); //$NON-NLS-1$
			return -1;
		} finally {
			IOUtils.closeQuietly(process);
			if (file != null) {
				FileUtils.deleteQuietly(file);
			}
		}
	}

	private void notify(String severity, String message) {
		if (notices != null) {
			notices.post(new Notice(NOTICE, severity, Messages.getString("CloudFetch.title"), message)); //$NON-NLS-1$
		}
	}
}
