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
import org.openforis.collect.earth.app.service.QuitService;
import org.openforis.collect.earth.app.service.dashboard.LocalDashboardService;
import org.openforis.collect.earth.app.service.notices.UpdateService;
import org.openforis.collect.earth.app.service.notices.UpdateService.UpdaterMissingException;
import org.openforis.collect.earth.app.view.Messages;
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

	private final Map<String, Runnable> actions;

	@Autowired
	public ActionsController(QuitService quit, BackupSqlLiteService backup, BrowserService browser, UpdateService updates,
			EarthSurveyService surveys, LocalDashboardService dashboard) {
		this(actions(quit, backup, browser, updates, surveys, dashboard));
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
		if (!CollectEarthUtils.openUrl(URI.create(url))) {
			throw new IllegalStateException("The browser could not open the dashboard");
		}
	}

	ActionsController(Map<String, Runnable> actions) {
		this.actions = actions;
	}

	private static Map<String, Runnable> actions(QuitService quit, BackupSqlLiteService backup, BrowserService browser, UpdateService updates,
			EarthSurveyService surveys, LocalDashboardService dashboard) {
		Map<String, Runnable> actions = new LinkedHashMap<>();
		actions.put("quit", quit);
		actions.put("openDashboard", () -> openDashboard(dashboard));
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
