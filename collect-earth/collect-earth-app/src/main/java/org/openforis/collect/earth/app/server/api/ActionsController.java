package org.openforis.collect.earth.app.server.api;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.io.UncheckedIOException;
import java.util.LinkedHashMap;
import java.util.Map;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.BackupSqlLiteService;
import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.QuitService;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardService;
import org.openforis.collect.earth.app.service.notices.UpdateService;
import org.openforis.collect.earth.app.service.notices.UpdateService.UpdaterMissingException;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Quick actions of the menus and the pages, by name; the later stages add theirs (open the data folder, the log, the
 * manual...). An action that fails throws, and the handler answers the fault as for any call.
 */
@RestController
public class ActionsController {

	static final String SUPPORT_URL = "https://www.openforis.support";

	/**
	 * For developers testing the local dashboard in a browser of their own (a test Chrome, Playwright): with
	 * -Dcollectearth.dashboard.logSignInUrl=true, My dashboard writes its one-time sign-in link to the log instead of
	 * opening it, as opening it would use it up in a browser they cannot drive. Off by default: the link signs in.
	 */
	static final String LOG_SIGN_IN_URL_PROPERTY = "collectearth.dashboard.logSignInUrl";
	private static final Logger logger = LoggerFactory.getLogger(ActionsController.class);

	private final Map<String, Runnable> actions;

	@Autowired
	public ActionsController(QuitService quit, BackupSqlLiteService backup, BrowserService browser, UpdateService updates,
			EarthSurveyService surveys, LocalDashboardService dashboard, LocalPropertiesService properties, CloudApiClient cloud) {
		this(actions(quit, backup, browser, updates, surveys, dashboard, properties, cloud));
	}

	/** The pages of the dashboard a sign-in link can open directly (the dashboard checks the same list). */
	static final String ANALYSIS_PAGE = "analysis"; //$NON-NLS-1$

	/**
	 * The address of the analysis page (docs/plans/2026-11-05-node-and-arena.md, stage 6a, what replaces Saiku): for a
	 * cloud project, the cloud dashboard's page of the project (the browser signs in there as on any visit); else the
	 * local dashboard's one-time sign-in link, told to open the page.
	 */
	static String analysisUrl(boolean cloud, String cloudBaseUrl, String cloudProjectId, String localSignInUrl) {
		if (cloud) {
			if (cloudBaseUrl == null || cloudBaseUrl.trim().isEmpty() || cloudProjectId == null || cloudProjectId.trim().isEmpty()) {
				return null;
			}
			String base = cloudBaseUrl.trim().replaceAll("/+$", ""); //$NON-NLS-1$ //$NON-NLS-2$
			try {
				return base + "/projects/" + java.net.URLEncoder.encode(cloudProjectId.trim(), "UTF-8").replace("+", "%20") + "/" + ANALYSIS_PAGE; //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$
			} catch (java.io.UnsupportedEncodingException e) {
				throw new IllegalStateException(e);
			}
		}
		if (localSignInUrl == null) {
			return null;
		}
		return localSignInUrl + (localSignInUrl.contains("?") ? "&" : "?") + "to=" + ANALYSIS_PAGE; //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
	}

	/** Tools > Analyse the data: the analysis page in the default browser, the cloud's for a cloud project. */
	static void openAnalysis(LocalDashboardService dashboard, LocalPropertiesService properties, CloudApiClient cloud) {
		boolean cloudProject = properties.isCloudSyncEnabled();
		String url;
		if (cloudProject) {
			CloudApiClient.Destination destination = cloud.cloudDestination();
			url = analysisUrl(true, destination.getBaseUrl(), destination.getProjectId(), null);
			if (url == null) {
				throw new ApiException("analysis.noCloudProject", Messages.getString("CollectEarthMenu.analyseNoCloud")); //$NON-NLS-1$ //$NON-NLS-2$
			}
		} else {
			String signIn;
			try {
				signIn = dashboard.newSignInUrl();
			} catch (IOException e) {
				throw new IllegalStateException("The dashboard did not give a sign-in link: " + e.getMessage(), e);
			}
			if (signIn == null) {
				throw new ApiException("dashboard.notReady", dashboard.getStateText());
			}
			url = analysisUrl(false, null, null, signIn);
			if (Boolean.getBoolean(LOG_SIGN_IN_URL_PROPERTY)) {
				logger.info("Analysis sign-in link (single use, 15 minutes; not opened, {} is set): {}", LOG_SIGN_IN_URL_PROPERTY, url);
				return;
			}
		}
		if (!CollectEarthUtils.openUrl(URI.create(url))) {
			throw new IllegalStateException("The browser could not open the analysis page");
		}
	}

	private static void openFile(File file) {
		if (!CollectEarthUtils.openFile(file)) {
			throw new IllegalStateException("The file could not be opened: " + file.getAbsolutePath());
		}
	}

	/**
	 * Tools > My dashboard: the local dashboard (docs/plans/2026-11-03-desktop-dashboard.md) in the default browser,
	 * signed in by a new one-time link. While it cannot be opened (getting ready, failed, not installed, a cloud
	 * project), the page is told why.
	 */
	static void openDashboard(LocalDashboardService dashboard) {
		String url;
		try {
			url = dashboard.newSignInUrl();
		} catch (IOException e) {
			throw new IllegalStateException("The dashboard did not give a sign-in link: " + e.getMessage(), e);
		}
		if (url == null) {
			throw new ApiException("dashboard.notReady", dashboard.getStateText());
		}
		if (Boolean.getBoolean(LOG_SIGN_IN_URL_PROPERTY)) {
			logger.info("Dashboard sign-in link (single use, 15 minutes; not opened, {} is set): {}", LOG_SIGN_IN_URL_PROPERTY, url);
			return;
		}
		if (!CollectEarthUtils.openUrl(URI.create(url))) {
			throw new IllegalStateException("The browser could not open the dashboard");
		}
	}

	ActionsController(Map<String, Runnable> actions) {
		this.actions = actions;
	}

	private static Map<String, Runnable> actions(QuitService quit, BackupSqlLiteService backup, BrowserService browser, UpdateService updates,
			EarthSurveyService surveys, LocalDashboardService dashboard, LocalPropertiesService properties, CloudApiClient cloud) {
		Map<String, Runnable> actions = new LinkedHashMap<>();
		actions.put("quit", quit);
		actions.put("openDashboard", () -> openDashboard(dashboard));
		actions.put("openAnalysis", () -> openAnalysis(dashboard, properties, cloud));
		// The Help menu's files and pages (CollectEarthMenu.getHelpMenu)
		actions.put("openSurveyGuide", () -> {
			File guide = surveys.getSurveyGuide();
			if (guide == null || !guide.exists() || !guide.canRead()) {
				throw new ApiException("help.guideMissing", Messages.getString("HelpPage.guideMissing"));
			}
			openFile(guide);
		});
		actions.put("openManual", () -> {
			File manual = new File(AppInfoController.USER_MANUAL);
			if (!manual.exists() || !manual.canRead()) {
				throw new ApiException("help.manualMissing", String.format(Messages.getString("CollectEarthMenu.userManualNotFound"), AppInfoController.USER_MANUAL));
			}
			openFile(manual);
		});
		actions.put("openSupport", () -> {
			if (!CollectEarthUtils.openUrl(URI.create(SUPPORT_URL))) {
				throw new IllegalStateException("The browser could not open " + SUPPORT_URL);
			}
		});
		// Check for updates (Help): the updater of the platform, which says when it is not there
		actions.put("runUpdater", () -> {
			try {
				updates.runUpdater();
			} catch (UpdaterMissingException e) {
				throw new ApiException("help.updaterMissing", e.getMessage());
			} catch (IOException e) {
				throw new IllegalStateException(e.getMessage(), e);
			}
		});
		// The Open data folder entry of the Tools menu
		actions.put("openDataFolder", () -> {
			String folder = FolderFinder.getCollectEarthDataFolder();
			if (folder == null || !new File(folder).isDirectory()) {
				throw new ApiException("folder.missing", String.format(Messages.getString("CollectEarthMenu.dataFolderNotFound"), folder));
			}
			try {
				CollectEarthUtils.openFolderInExplorer(folder);
			} catch (IOException e) {
				throw new UncheckedIOException(e);
			}
		});
		// The Open plots map entry, with the Google Earth Pro viewer: a browser takes seconds, so on a thread as before
		actions.put("openPlotsMap", () -> new Thread(browser::openLeafletMap, "Open Leaflet plots map").start());
		// The Open backup folder button of the storage section of the settings
		actions.put("openBackupFolder", () -> {
			try {
				CollectEarthUtils.openFolderInExplorer(backup.getAutomaticBackUpFolder().getAbsolutePath());
			} catch (IOException e) {
				throw new UncheckedIOException(e);
			}
		});
		return actions;
	}

	/** Quitting answers before the server stops: QuitService does it on a thread of its own. */
	@PostMapping("/api/actions/{name}")
	public ResponseEntity<Void> action(@PathVariable("name") String name) {
		Runnable action = actions.get(name);
		if (action == null) {
			return ResponseEntity.notFound().build();
		}
		action.run();
		return ResponseEntity.ok().build();
	}
}
