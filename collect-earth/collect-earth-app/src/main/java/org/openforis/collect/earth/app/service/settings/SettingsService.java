package org.openforis.collect.earth.app.service.settings;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.RestartService;
import org.openforis.collect.earth.app.service.settings.Setting.Type;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * The settings as the page reads, checks and saves them: the stored values as the Swing dialog showed them, the
 * validation of what the page holds, and the saving of its changes in one write, followed by a restart when a setting
 * only a new server reads changed, or else by a reload of the plots, as applying the dialog did.
 */
@Service
public class SettingsService {

	/** The changes break a rule: nothing was saved. */
	public static class InvalidSettingsException extends Exception {
		private static final long serialVersionUID = 1L;
		private final Map<String, String> errors;

		public InvalidSettingsException(Map<String, String> errors) {
			super("The settings are not valid: " + errors);
			this.errors = errors;
		}

		public Map<String, String> getErrors() {
			return errors;
		}
	}

	private final LocalPropertiesService properties;
	private final SettingsValidator validator;
	private final Runnable restart;
	private final Runnable reload;
	/** The check of a plots file (SampleFileCheck.check), or null for none */
	private final Function<String, Map<String, Object>> sampleFileCheck;

	@Autowired
	public SettingsService(LocalPropertiesService properties, SettingsValidator validator, RestartService restart, SampleFileCheck sampleFile) {
		this(properties, validator, restart, EarthApp::reloadPlots, sampleFile::check);
	}

	/** For the tests: what to run for a restart and for a reload of the plots; no plots file is read. */
	public SettingsService(LocalPropertiesService properties, SettingsValidator validator, Runnable restart, Runnable reload) {
		this(properties, validator, restart, reload, path -> null);
	}

	/** For the tests: with the check of the plots file. */
	public SettingsService(LocalPropertiesService properties, SettingsValidator validator, Runnable restart, Runnable reload,
			Function<String, Map<String, Object>> sampleFileCheck) {
		this.properties = properties;
		this.validator = validator;
		this.restart = restart;
		this.reload = reload;
		this.sampleFileCheck = sampleFileCheck;
	}

	public SettingsModel getModel() {
		return validator.getModel();
	}

	/**
	 * The stored value of every setting, by key, as the dialog showed it: a number within its range (the spinners
	 * replaced what was not), the form and driver resolved to one of their choices (as
	 * LocalPropertiesService resolves them), a switch as true or false, the reference area shape as the panel showed
	 * it for the projects older than the setting, and the first of several reference distances.
	 */
	public Map<String, String> current() {
		Map<String, String> values = new LinkedHashMap<>();
		for (Setting setting : getModel().settings()) {
			values.put(setting.key(), stored(setting.getProperty()));
		}
		for (Setting setting : getModel().settings()) {
			values.put(setting.key(), shown(setting, values));
		}
		return values;
	}

	/** A setting as stored; the cloud ones are the open project's cloud project's (LocalPropertiesService.getCloudBinding) */
	private String stored(EarthProperty property) {
		if (property == EarthProperty.CLOUD_SYNC_URL) {
			return properties.getCloudSyncUrl();
		} else if (property == EarthProperty.CLOUD_PROJECT_ID) {
			return properties.getCloudProjectId();
		} else if (property == EarthProperty.CLOUD_SYNC_TOKEN) {
			return properties.getCloudSyncToken();
		}
		return properties.getValue(property);
	}

	private String shown(Setting setting, Map<String, String> stored) {
		String value = Condition.valueOf(stored, setting.key());
		EarthProperty property = setting.getProperty();
		if (property == EarthProperty.DB_DRIVER) {
			CollectDBDriver driver = properties.getCollectDBDriver();
			return (driver == null ? CollectDBDriver.SQLITE : driver).name();
		} else if (property == EarthProperty.SAMPLE_SHAPE) {
			return PlotGeometry.shapeOf(stored).name();
		} else if (property == EarthProperty.BUFFER_SHAPE) {
			return PlotGeometry.bufferShapeOf(stored).name();
		} else if (property == EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT) {
			return String.valueOf(PlotGeometry.of(stored).getPoints());
		} else if (property == EarthProperty.DISTANCE_TO_BUFFERS) {
			return String.valueOf(PlotGeometry.of(stored).getReferenceDistance());
		}
		switch (setting.getType()) {
		case INTEGER:
			return String.valueOf(PlotGeometry.parseIntWithinRange(value, PlotGeometry.parseIntWithinRange(setting.getDefaultValue(),
					setting.getMin(), setting.getMin(), setting.getMax()), setting.getMin(), setting.getMax()));
		case BOOLEAN:
			return String.valueOf(Boolean.parseBoolean(value.trim()));
		case PASSWORD:
			return value;
		default:
			return value.trim();
		}
	}

	/** The rules over the stored values with these over them. */
	public Validation validate(Map<String, String> given) {
		Map<String, String> current = current();
		Map<String, String> merged = overlay(current, given);
		Validation validation = validator.validate(merged);
		refuseCoordinatorsSettings(current, given, merged, validation);
		return validation;
	}

	/**
	 * Whether the values are of the open cloud project's (another database in them leaves it, which is not held back).
	 * Its plot design is the coordinator's, from the project file of the cloud project (written when it is joined or its
	 * project file loaded again, not here).
	 */
	private boolean inCloudProject(Map<String, String> merged) {
		return properties.isCloudSyncEnabled()
				&& CollectDBDriver.CLOUD.name().equals(Condition.valueOf(merged, EarthProperty.DB_DRIVER.toString()).trim());
	}

	private boolean isCoordinators(Setting setting) {
		return getModel().coordinatorsSection(setting) != null;
	}

	/**
	 * In a cloud project the settings of the plot section (the shape and size of the plot, its reference area) and of the
	 * imagery section but the Planet key (the windows opened beside each plot) are set by its coordinator: a change to one
	 * is refused at it. Their rules are not run on the values kept, which are not the collector's to correct.
	 */
	private void refuseCoordinatorsSettings(Map<String, String> current, Map<String, String> given, Map<String, String> merged, Validation validation) {
		if (!inCloudProject(merged)) {
			return;
		}
		for (Setting setting : getModel().settings()) {
			if (!isCoordinators(setting)) {
				continue;
			}
			String key = setting.key();
			boolean changed = given != null && given.containsKey(key)
					&& !StringUtils.trimToEmpty(given.get(key)).equals(StringUtils.trimToEmpty(current.get(key)));
			validation.replaceError(key, changed ? Messages.getString("SettingsPage." + getModel().coordinatorsSection(setting) + ".cloudLocked") : null); //$NON-NLS-1$ //$NON-NLS-2$
		}
	}

	/**
	 * Saves the changes that pass the rules and differ from what is stored, only of the settings shown for the values
	 * that result, plus a blank for the settings saved blank while hidden. Then restarts Collect Earth if a setting that
	 * needs it changed, and otherwise reloads the plots when anything changed.
	 *
	 * @return whether Collect Earth restarts
	 * @throws InvalidSettingsException when a rule is broken, with the errors by key; nothing is then saved
	 */
	public boolean save(Map<String, String> changes) throws InvalidSettingsException {
		Map<String, String> current = current();
		Map<String, String> merged = overlay(current, changes);
		Validation validation = validator.validate(merged);
		refuseCoordinatorsSettings(current, changes, merged, validation);
		refuseBlockingSampleFile(current, changes, validation);
		boolean coordinatorsKept = inCloudProject(merged);
		if (!validation.isValid()) {
			throw new InvalidSettingsException(validation.getErrors());
		}
		Map<String, String> toWrite = new LinkedHashMap<>();
		boolean restartNeeded = false;
		for (Setting setting : getModel().settings()) {
			String key = setting.key();
			// Nothing of the coordinator's plot design or imagery windows is written in a cloud project, a blank of a hidden one neither
			if (coordinatorsKept && isCoordinators(setting)) {
				continue;
			}
			String value;
			if (setting.isVisible(merged)) {
				// a password sent as null is left as it is
				if (!changes.containsKey(key) || setting.getType() == Type.PASSWORD && changes.get(key) == null) {
					continue;
				}
				value = setting.getType() == Type.PASSWORD ? changes.get(key) : StringUtils.trimToEmpty(changes.get(key));
			} else if (setting.isBlankWhenHidden()) {
				value = "";
			} else {
				continue;
			}
			if (value.equals(stored(setting.getProperty()))) {
				continue;
			}
			toWrite.put(key, value);
			restartNeeded |= setting.isRestart();
		}
		if (toWrite.isEmpty()) {
			return false;
		}
		// The cloud fields are the open project's cloud project's, and the token its server's
		String url = toWrite.remove(EarthProperty.CLOUD_SYNC_URL.toString());
		String projectId = toWrite.remove(EarthProperty.CLOUD_PROJECT_ID.toString());
		String token = toWrite.remove(EarthProperty.CLOUD_SYNC_TOKEN.toString());
		if (!toWrite.isEmpty()) {
			properties.setValues(toWrite);
		}
		if (url != null) {
			properties.saveCloudSyncUrl(url);
		}
		if (projectId != null) {
			properties.saveCloudProjectId(projectId);
		}
		if (token != null) {
			properties.saveCloudSyncToken(token);
		}
		if (restartNeeded) {
			restart.run();
		} else {
			reload.run();
		}
		return restartNeeded;
	}

	/** A plots file changed to one the page would refuse (SampleFileCheck.isBlocking) is refused here too. */
	@SuppressWarnings("unchecked")
	private void refuseBlockingSampleFile(Map<String, String> current, Map<String, String> changes, Validation validation) {
		String key = EarthProperty.SAMPLE_FILE.toString();
		String path = changes == null ? null : StringUtils.trimToNull(changes.get(key));
		if (path == null || path.equals(StringUtils.trimToEmpty(current.get(key))) || validation.hasError(key)) {
			return;
		}
		Map<String, Object> check = sampleFileCheck.apply(path);
		if (check == null || !SampleFileCheck.isBlocking(check)) {
			return;
		}
		for (Map<String, Object> problem : (List<Map<String, Object>>) check.get("problems")) {
			if (Boolean.TRUE.equals(problem.get("blocking"))) {
				validation.error(key, String.valueOf(problem.get("message")));
				return;
			}
		}
	}

	private static Map<String, String> overlay(Map<String, String> base, Map<String, String> over) {
		Map<String, String> merged = new LinkedHashMap<>(base);
		if (over != null) {
			for (Map.Entry<String, String> entry : over.entrySet()) {
				merged.put(entry.getKey(), entry.getValue() == null ? "" : entry.getValue());
			}
		}
		return Collections.unmodifiableMap(merged);
	}
}
