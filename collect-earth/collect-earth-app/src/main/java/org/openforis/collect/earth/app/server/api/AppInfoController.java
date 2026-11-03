package org.openforis.collect.earth.app.server.api;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
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

	/** The user manual the installer puts next to Collect Earth (CollectEarthMenu) */
	static final String USER_MANUAL = "UserManual.pdf";

	private final LocalPropertiesService properties;
	/** The project name, from the survey: a supplier, as the survey changes when another project is loaded */
	private final Supplier<String> projectName;
	/** Where the installed version is read from, once (see version()) */
	private final Supplier<String> installedVersion;
	private volatile String version;
	/** The survey's guide, if it has one: a supplier, as the survey changes */
	private final Supplier<File> surveyGuide;
	private final Supplier<String> buildDate;
	private volatile String build;
	private final File manual;

	@Autowired
	public AppInfoController(LocalPropertiesService properties, EarthSurveyService surveys) {
		this(properties, () -> {
			CollectSurvey survey = surveys.getCollectSurvey();
			// the UI language is only read when there is a survey, as before
			return survey == null ? null : projectName(survey, properties.getUiLanguage().getLocale().getLanguage());
		}, UpdateIniUtils::getVersionNameInstalled, surveys::getSurveyGuide, () -> new UpdateIniUtils().getBuildDate(), new File(USER_MANUAL));
	}

	/** For the tests, which have no survey to load nor update.ini to read */
	AppInfoController(LocalPropertiesService properties, Supplier<String> projectName, Supplier<String> installedVersion,
			Supplier<File> surveyGuide, Supplier<String> buildDate, File manual) {
		this.properties = properties;
		this.projectName = projectName;
		this.installedVersion = installedVersion;
		this.surveyGuide = surveyGuide;
		this.buildDate = buildDate;
		this.manual = manual;
	}

	/**
	 * The name the title of the Swing main window shows (CollectEarthWindow.changeFrameTitle): in the UI language if the
	 * survey has it in that language, else in its default one, else the survey's description. Null when there is no
	 * survey. Package-private for the tests, which stub the supplier that calls it.
	 *
	 * @param language the UI language, as a two-letter code
	 */
	static String projectName(CollectSurvey survey, String language) {
		if (survey == null) {
			return null;
		}
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
		String operator = properties.getOperator();
		app.put("operator", operator);
		app.put("language", properties.getUiLanguage().getLocale().getLanguage());
		app.put("viewer", properties.getValue(EarthProperty.VIEWER_TYPE));
		app.put("plotsMap", properties.isPlotsMapViewer());
		app.put("version", version());
		// Stage 5: the title, the Help menu and the About dialog, the cloud login
		boolean cloud = properties.isCloudSyncEnabled();
		app.put("cloud", cloud);
		// In cloud mode the operator is the user logged in (CollectEarthWindow.promptCloudLogin): none means not logged in
		app.put("cloudLoginNeeded", cloud && StringUtils.isBlank(operator));
		app.put("errorsShown", Boolean.TRUE.equals(properties.isExceptionShown()));
		File guide = surveyGuide.get();
		app.put("surveyGuide", guide != null && guide.exists() && guide.canRead());
		app.put("manual", manual.exists() && manual.canRead());
		app.put("build", build());
		app.put("java", System.getProperty("java.version"));
		app.put("languages", languages());
		// A client of another Collect Earth has no data of its own: the Swing window disabled the entries that act on it
		app.put("client", properties.getOperationMode() == OperationMode.CLIENT_MODE);
		return app;
	}

	private static List<Map<String, String>> languages() {
		List<Map<String, String>> languages = new ArrayList<>();
		for (UI_LANGUAGE language : UI_LANGUAGE.values()) {
			Map<String, String> entry = new LinkedHashMap<>();
			entry.put("code", language.name());
			entry.put("label", language.getLabel());
			languages.add(entry);
		}
		return languages;
	}

	/** The build date, read once as the version is */
	private String build() {
		if (build == null) {
			build = buildDate.get();
		}
		return build;
	}

	/** The Language menu: the setting, and the texts of the dialogs that are still Swing; the page then reloads itself. */
	@PutMapping("/api/app/language")
	public void language(@RequestBody Map<String, String> body) {
		UI_LANGUAGE language;
		try {
			language = UI_LANGUAGE.valueOf(body.getOrDefault("language", "").trim().toUpperCase(Locale.ROOT));
		} catch (IllegalArgumentException e) {
			throw new ApiException("language.unknown", Messages.getString("AppInfoController.languageUnknown"));
		}
		properties.setUiLanguage(language);
		Messages.setLocale(language.getLocale());
	}

	/**
	 * The installed version, read from update.ini the first time it is asked for: it does not change while the
	 * application runs, and when the file is missing, as when running from the IDE, every read logs an error, which goes
	 * to Sentry. UpdateIniUtils then answers "unknown", which is kept like any other value. Two first requests at once
	 * may both read it, which does no harm.
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
		// The rule of the Swing main window (CollectEarthWindow.updateOperatorName), which User.nameLength states
		if (operator.length() <= 5 || operator.length() >= 50) {
			throw new ApiException("operator.length", Messages.getString("User.nameLength"));
		}
		properties.saveOperator(operator);
	}
}
