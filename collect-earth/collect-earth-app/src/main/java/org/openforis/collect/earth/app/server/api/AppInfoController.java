package org.openforis.collect.earth.app.server.api;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.model.CollectSurvey;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** What the app bar and the home page show (app.ts), and the operator they let the user change. */
@RestController
public class AppInfoController {

	private final LocalPropertiesService properties;
	/** The project name, from the survey: a supplier, as the survey changes when another project is loaded */
	private final Supplier<String> projectName;
	/** Where the installed version is read from, once (see version()) */
	private final Supplier<String> installedVersion;
	private volatile String version;

	@Autowired
	public AppInfoController(LocalPropertiesService properties, EarthSurveyService surveys) {
		this(properties, () -> projectName(surveys.getCollectSurvey(), properties),
				UpdateIniUtils::getVersionNameInstalled);
	}

	/** For the tests, which have no survey to load nor update.ini to read */
	AppInfoController(LocalPropertiesService properties, Supplier<String> projectName, Supplier<String> installedVersion) {
		this.properties = properties;
		this.projectName = projectName;
		this.installedVersion = installedVersion;
	}

	/**
	 * The name the title of the Swing main window shows (CollectEarthWindow.changeFrameTitle): in the UI language if the
	 * survey has it in that language, else in its default one, else the survey's description.
	 */
	private static String projectName(CollectSurvey survey, LocalPropertiesService properties) {
		if (survey == null) {
			return null;
		}
		String language = properties.getUiLanguage().getLocale().getLanguage();
		if (StringUtils.isNotBlank(survey.getProjectName(language))) {
			return survey.getProjectName(language);
		} else if (StringUtils.isNotBlank(survey.getProjectName())) {
			return survey.getProjectName();
		}
		return survey.getDescription(language);
	}

	@GetMapping("/api/app")
	public Map<String, Object> app() {
		Map<String, Object> app = new LinkedHashMap<>();
		app.put("project", projectName.get());
		app.put("operator", properties.getOperator());
		app.put("language", properties.getUiLanguage().getLocale().getLanguage());
		app.put("viewer", properties.getValue(EarthProperty.VIEWER_TYPE));
		app.put("plotsMap", properties.isPlotsMapViewer());
		app.put("version", version());
		return app;
	}

	/**
	 * The installed version, read from update.ini the first time it is asked for: it does not change while the
	 * application runs, and when the file is missing, as when running from the IDE, every read logs an error, which goes
	 * to Sentry. "unknown" then. Two first requests at once may both read it, which does no harm.
	 */
	private String version() {
		if (version == null) {
			version = installedVersion.get();
		}
		return version;
	}

	@PutMapping("/api/app/operator")
	public void operator(@RequestBody Map<String, String> body) {
		// In cloud mode the operator is the user of the cloud login, as in the Swing main window, which ignores the field
		if (properties.isCloudSyncEnabled()) {
			throw new ApiException("operator.cloud", Messages.getString("AppInfoController.operatorCloud"));
		}
		String operator = body.get("operator") == null ? "" : body.get("operator").trim();
		// The rule of the Swing main window (CollectEarthWindow.updateOperatorName), which CollectEarthWindow.33 states
		if (operator.length() <= 5 || operator.length() >= 50) {
			throw new ApiException("operator.length", Messages.getString("CollectEarthWindow.33"));
		}
		properties.saveOperator(operator);
	}
}
