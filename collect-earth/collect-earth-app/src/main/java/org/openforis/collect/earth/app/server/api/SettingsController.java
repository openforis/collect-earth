package org.openforis.collect.earth.app.server.api;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.BackupSqlLiteService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.settings.SettingsService;
import org.openforis.collect.earth.app.service.settings.SettingsService.InvalidSettingsException;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The settings for the settings page (SettingsPage.tsx): their description and values, the check of what the page
 * holds while the user types, the saving of the changes, and the connection tests of the storage sections.
 */
@RestController
public class SettingsController {

	/** What CollectEarthUtils' connection tests answer when the connection works */
	static final String CONNECTION_OK = "Connection OK!";

	/** The body of validate and save: the values by key. */
	public static class Values {
		public Map<String, String> values;
	}

	public static class DatabaseRequest {
		public String host;
		public String port;
		public String name;
		public String username;
		public String password;
	}

	public static class CloudRequest {
		public String url;
		public String projectId;
		public String token;
	}

	private final SettingsService settings;
	private final Supplier<String> backupFolder;
	private final Supplier<String> computerIp;
	private final Function<DatabaseRequest, String> testDatabase;
	private final Function<CloudRequest, String> testCloud;

	@Autowired
	public SettingsController(SettingsService settings, BackupSqlLiteService backup) {
		this(settings, () -> backup.getAutomaticBackUpFolder().getAbsolutePath(), CollectEarthUtils::getComputerIp,
				request -> CollectEarthUtils.testPostgreSQLConnection(request.host, request.port, request.name, request.username,
						request.password),
				request -> CollectEarthUtils.testCloudConnection(request.url, request.projectId, request.token));
	}

	/** For the tests: the folder, the address and the connection tests stood in for. */
	SettingsController(SettingsService settings, Supplier<String> backupFolder, Supplier<String> computerIp,
			Function<DatabaseRequest, String> testDatabase, Function<CloudRequest, String> testCloud) {
		this.settings = settings;
		this.backupFolder = backupFolder;
		this.computerIp = computerIp;
		this.testDatabase = testDatabase;
		this.testCloud = testCloud;
	}

	@GetMapping("/api/settings")
	public Map<String, Object> settings() {
		Map<String, String> values = settings.current();
		Map<String, Object> info = new LinkedHashMap<>();
		info.put("computerIp", computerIp.get());
		info.put("backupFolder", backupFolder.get());
		info.put("cloudMode", CollectDBDriver.CLOUD.name().equals(values.get(EarthProperty.DB_DRIVER.toString())));
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("sections", settings.getModel().toJson());
		answer.put("values", values);
		answer.put("info", info);
		return answer;
	}

	@PostMapping("/api/settings/validate")
	public Map<String, Object> validate(@RequestBody Values body) {
		return settings.validate(valuesOf(body)).toJson();
	}

	/**
	 * Saves the changes, and answers whether Collect Earth restarts for them (RestartService, after the answer). The
	 * changes that break a rule are refused with the errors by key, which the page shows at the fields.
	 */
	@PostMapping("/api/settings")
	public ResponseEntity<Map<String, Object>> save(@RequestBody Values body) {
		Map<String, Object> answer = new LinkedHashMap<>();
		try {
			answer.put("restart", settings.save(valuesOf(body)));
			return ResponseEntity.ok(answer);
		} catch (InvalidSettingsException e) {
			answer.put("error", "settings.invalid");
			answer.put("message", Messages.getString("PropertiesDialog.validationErrors"));
			answer.put("details", null);
			answer.put("errors", e.getErrors());
			return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(answer);
		}
	}

	/** Tries the PostgreSQL connection with the values typed, not the stored ones, as the dialog's button did. */
	@PostMapping("/api/settings/testDatabase")
	public Map<String, Object> testDatabase(@RequestBody DatabaseRequest request) {
		return connection(testDatabase.apply(request));
	}

	@PostMapping("/api/settings/testCloud")
	public Map<String, Object> testCloud(@RequestBody CloudRequest request) {
		return connection(testCloud.apply(request));
	}

	private static Map<String, Object> connection(String message) {
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("ok", CONNECTION_OK.equals(message));
		answer.put("message", message);
		return answer;
	}

	private static Map<String, String> valuesOf(Values body) {
		return body == null || body.values == null ? Collections.emptyMap() : body.values;
	}
}
