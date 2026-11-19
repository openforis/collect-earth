package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.text.MessageFormat;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.RestartService;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.stereotype.Component;

/**
 * A cloud project's survey changed by its coordinator in the dashboard's designer (docs/plans/2026-11-18-survey-designer.md,
 * stage 6): soon after the start, and every ten minutes, the revision the server serves (GET /survey/revision) is compared
 * with the one this computer has (SurveyRevision: the same name, of the survey file's bytes). When it differs, a notice
 * offers to take it now: the records not sent yet are sent first, in the shape of the survey they were made with (when
 * some cannot be, offline, nothing is changed and it is offered again later); then the project is downloaded and loaded
 * again, as when it is opened from the list of projects, and Collect Earth restarts. "Later" asks again at the next
 * start. A server without the designer answers 404, and nothing is asked.
 */
@Component
public class SurveyUpdateService implements ApplicationListener<ContextRefreshedEvent> {

	/** The offer's kind: one at a time */
	public static final String NOTICE = "cloudSurveyChanged";
	/** The kind of what an update says after (not taken, records not sent): not taken for an offer waiting */
	public static final String RESULT_NOTICE = "cloudSurveyUpdate";
	static final String UPDATE = "update";
	static final String LATER = "later";
	private static final long FIRST_CHECK_SECONDS = 20;
	private static final long CHECK_INTERVAL_MINUTES = 10;
	/** How long the records not sent yet are tried before a changed survey is taken */
	static final long SEND_TIMEOUT_MS = 30_000;

	private final Logger logger = LoggerFactory.getLogger(SurveyUpdateService.class);

	@Autowired
	private LocalPropertiesService properties;
	@Autowired
	private CloudApiClient api;
	@Autowired(required = false)
	private NoticeService notices;
	/** Taken when asked: CloudService needs services started after this one */
	@Autowired
	private ObjectProvider<CloudService> cloud;
	@Autowired(required = false)
	private RestartService restart;
	/** Sends the records not sent yet before the survey changes */
	@Autowired(required = false)
	private CloudSyncService sync;
	/** Writes the form's last changes, so that they are sent too */
	@Autowired(required = false)
	private EarthSurveyService surveys;

	private final AtomicBoolean started = new AtomicBoolean(false);
	/** An update under way: a second "Update now" meanwhile is ignored */
	private final AtomicBoolean updating = new AtomicBoolean(false);
	/** The survey was taken and Collect Earth restarts: nothing is asked any more */
	private volatile boolean updated;
	/** The revision a notice was posted for, this start: not asked again until another one */
	private volatile String noticed;
	private ScheduledExecutorService executor;

	/** What a check does, from the revision this computer has, the one served, and those already asked about */
	enum Decision {
		/** The same survey, or nothing to compare with, or already asked about */
		NOTHING,
		/** Another survey: the person is asked */
		ASK
	}

	/**
	 * @param known the revision this computer has
	 * @param served the one the server serves
	 * @param noticed the one already offered since the start
	 * @param refused one taken that could not be used here (EarthSurveyService)
	 */
	static Decision decide(String known, String served, String noticed, String refused) {
		if (StringUtils.isBlank(served) || StringUtils.isBlank(known)) {
			return Decision.NOTHING;
		}
		if (known.equals(served) || served.equals(noticed) || served.equals(refused)) {
			return Decision.NOTHING;
		}
		return Decision.ASK;
	}

	@Override
	public void onApplicationEvent(ContextRefreshedEvent event) {
		if (!properties.isCloudSyncEnabled() || !started.compareAndSet(false, true)) {
			return;
		}
		executor = Executors.newSingleThreadScheduledExecutor(r -> {
			Thread thread = new Thread(r, "CollectEarth-survey-update");
			thread.setDaemon(true);
			return thread;
		});
		executor.scheduleWithFixedDelay(this::check, FIRST_CHECK_SECONDS, CHECK_INTERVAL_MINUTES * 60, TimeUnit.SECONDS);
	}

	/** One check: the served revision compared with this computer's */
	void check() {
		if (updated) {
			return;
		}
		try {
			CloudBinding binding = properties.getCloudBinding();
			String token = properties.getCloudSyncToken();
			if (binding == null || StringUtils.isBlank(token) || StringUtils.isBlank(binding.projectId)) {
				return;
			}
			String served = api.surveyRevision(new CloudApiClient.Destination(binding.server, binding.projectId, token));
			if (StringUtils.isBlank(served)) {
				return;
			}
			if (decide(knownRevision(binding), served, noticed, binding.surveyRevisionRefused) == Decision.ASK) {
				ask(binding, served);
			}
		} catch (IOException e) {
			// offline, signed out: the next check asks again
			logger.debug("The survey's revision could not be checked: {}", e.getMessage());
		} catch (RuntimeException e) {
			logger.warn("The survey's revision could not be checked", e);
		}
	}

	/**
	 * The revision of the survey this computer has: the one kept when the project was opened, else (opened by an earlier
	 * version) the one of its survey file, kept from then on. Not the server's: the person may have opened the project
	 * before the coordinator changed its survey, and would never be offered the change.
	 */
	String knownRevision(CloudBinding binding) {
		if (StringUtils.isNotBlank(binding.surveyRevision)) {
			return binding.surveyRevision;
		}
		String imd = properties.getImdFile();
		String local = StringUtils.isBlank(imd) ? null : SurveyRevision.ofFile(new File(imd));
		if (local != null && StringUtils.isNotBlank(binding.folder)) {
			properties.updateCloudBinding(new File(binding.folder), stored -> {
				if (StringUtils.isBlank(stored.surveyRevision)) {
					stored.surveyRevision = local;
				}
			});
		}
		return local;
	}

	private void ask(CloudBinding binding, String served) {
		noticed = served;
		// One offer at a time: the one waiting takes the survey served when it is answered, this one too
		if (notices == null || notices.hasPending(NOTICE)) {
			return;
		}
		String name = StringUtils.defaultIfBlank(binding.projectName, binding.projectId);
		Notice notice = new Notice(NOTICE, Notice.INFO, Messages.getString("CloudSurvey.changed.title"),
				MessageFormat.format(Messages.getString("CloudSurvey.changed.message"), name))
				.option(UPDATE, Messages.getString("CloudSurvey.update"))
				.option(LATER, Messages.getString("CloudSurvey.later"));
		notices.post(notice, option -> {
			if (UPDATE.equals(option)) {
				update(binding);
			}
		});
	}

	/**
	 * The records not sent yet sent, then the project downloaded and loaded again, as from the list of projects, then the
	 * restart. One at a time: asked again while one runs, nothing is done.
	 */
	void update(CloudBinding binding) {
		if (updated || !updating.compareAndSet(false, true)) {
			logger.info("The changed survey is being taken already");
			return;
		}
		try {
			int unsent = sendRecords();
			if (unsent > 0) {
				// Taken now, they would be read with the new survey after the restart and sent in its shape: the answers
				// of the questions taken away lost, the new ones sent empty
				logger.info("The changed survey is not taken now: {} records are not sent yet", unsent);
				noticed = null; // offered again at the next check
				post(Notice.WARNING, MessageFormat.format(Messages.getString("CloudSurvey.unsent"), unsent));
				return;
			}
			cloud.getObject().open(binding.projectId, binding.server);
			updated = true;
		} catch (CloudService.InvalidCloudRequestException | IOException | RuntimeException e) {
			logger.warn("The changed survey could not be taken", e);
			post(Notice.WARNING, MessageFormat.format(Messages.getString("CloudSurvey.failed"), StringUtils.defaultString(e.getMessage())));
			return;
		} finally {
			if (!updated) {
				updating.set(false);
			}
		}
		if (restart != null) {
			restart.run();
		}
	}

	/** The form's last changes written, then the records not sent yet sent now: how many could not be */
	private int sendRecords() {
		if (surveys != null) {
			surveys.flushAll();
		}
		return sync == null ? 0 : sync.sendNow(SEND_TIMEOUT_MS);
	}

	private void post(String severity, String message) {
		if (notices != null) {
			notices.post(new Notice(RESULT_NOTICE, severity, Messages.getString("CloudSurvey.changed.title"), message));
		}
	}
}
