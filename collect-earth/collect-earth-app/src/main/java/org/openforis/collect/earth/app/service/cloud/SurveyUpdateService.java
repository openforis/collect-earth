package org.openforis.collect.earth.app.service.cloud;

import java.io.IOException;
import java.text.MessageFormat;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.apache.commons.lang3.StringUtils;
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
 * with the one this computer opened. When it differs, a notice offers to take it now: the project is downloaded and
 * loaded again, as when it is opened from the list of projects, and Collect Earth restarts; the records collected stay,
 * and those not sent yet are sent after. "Later" asks again at the next start. A server without the designer answers 404,
 * and nothing is asked.
 */
@Component
public class SurveyUpdateService implements ApplicationListener<ContextRefreshedEvent> {

	/** The notice's kind */
	public static final String NOTICE = "cloudSurveyChanged";
	static final String UPDATE = "update";
	static final String LATER = "later";
	private static final long FIRST_CHECK_SECONDS = 20;
	private static final long CHECK_INTERVAL_MINUTES = 10;

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

	private final AtomicBoolean started = new AtomicBoolean(false);
	/** The revision a notice was posted for, this start: not asked again until another one */
	private volatile String noticed;
	private ScheduledExecutorService executor;

	/** What a check does, from the revision this computer has, the one served, and the one already asked about */
	enum Decision {
		/** The same survey, or nothing to compare with */
		NOTHING,
		/** The first revision known (a project opened before this version): taken as the one this computer has */
		REMEMBER,
		/** Another survey: the person is asked */
		ASK
	}

	static Decision decide(String known, String served, String noticed) {
		if (StringUtils.isBlank(served)) {
			return Decision.NOTHING;
		}
		if (StringUtils.isBlank(known)) {
			return Decision.REMEMBER;
		}
		if (known.equals(served) || served.equals(noticed)) {
			return Decision.NOTHING;
		}
		return Decision.ASK;
	}

	/** The served survey's revision, or null when the server could not say (the project is opened all the same) */
	static String revisionOrNull(CloudApiClient api, CloudBinding binding, String token) {
		try {
			return api.surveyRevision(new CloudApiClient.Destination(binding.server, binding.projectId, token));
		} catch (IOException | RuntimeException e) {
			LoggerFactory.getLogger(SurveyUpdateService.class).debug("The survey's revision could not be asked for: {}", e.getMessage());
			return null;
		}
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
		try {
			CloudBinding binding = properties.getCloudBinding();
			String token = properties.getCloudSyncToken();
			if (binding == null || StringUtils.isBlank(token) || StringUtils.isBlank(binding.projectId)) {
				return;
			}
			String served = api.surveyRevision(new CloudApiClient.Destination(binding.server, binding.projectId, token));
			switch (decide(binding.surveyRevision, served, noticed)) {
			case REMEMBER:
				binding.surveyRevision = served;
				properties.saveCloudBinding(binding);
				break;
			case ASK:
				noticed = served;
				ask(binding);
				break;
			default:
				break;
			}
		} catch (IOException e) {
			// offline, signed out: the next check asks again
			logger.debug("The survey's revision could not be checked: {}", e.getMessage());
		} catch (RuntimeException e) {
			logger.warn("The survey's revision could not be checked", e);
		}
	}

	private void ask(CloudBinding binding) {
		if (notices == null) {
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

	/** The project downloaded and loaded again, as from the list of projects, then the restart */
	void update(CloudBinding binding) {
		try {
			cloud.getObject().open(binding.projectId, binding.server);
		} catch (CloudService.InvalidCloudRequestException | IOException | RuntimeException e) {
			logger.warn("The changed survey could not be taken", e);
			if (notices != null) {
				notices.post(new Notice(NOTICE, Notice.WARNING, Messages.getString("CloudSurvey.changed.title"),
						MessageFormat.format(Messages.getString("CloudSurvey.failed"), StringUtils.defaultString(e.getMessage()))));
			}
			return;
		}
		if (restart != null) {
			restart.run();
		}
	}
}
