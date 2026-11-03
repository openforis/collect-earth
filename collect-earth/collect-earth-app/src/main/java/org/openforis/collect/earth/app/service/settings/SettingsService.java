package org.openforis.collect.earth.app.service.settings;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.RestartService;
import org.openforis.collect.earth.app.service.settings.Setting.Type;
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

	@Autowired
	public SettingsService(LocalPropertiesService properties, SettingsValidator validator, RestartService restart) {
		this(properties, validator, restart, EarthApp::reloadPlots);
	}

	/** For the tests: what to run for a restart and for a reload of the plots. */
	public SettingsService(LocalPropertiesService properties, SettingsValidator validator, Runnable restart, Runnable reload) {
		this.properties = properties;
		this.validator = validator;
		this.restart = restart;
		this.reload = reload;
	}

	public SettingsModel getModel() {
		return validator.getModel();
	}

	/**
	 * The stored value of every setting, by key, as the dialog showed it: a number within its range (the spinners
	 * replaced what was not), the viewer, layout, map engine, form and driver resolved to one of their choices (as
	 * LocalPropertiesService resolves them), a switch as true or false, the reference area shape as the panel showed
	 * it for the projects older than the setting, and the first of several reference distances.
	 */
	public Map<String, String> current() {
		Map<String, String> values = new LinkedHashMap<>();
		for (Setting setting : getModel().settings()) {
			values.put(setting.key(), properties.getValue(setting.getProperty()));
		}
		for (Setting setting : getModel().settings()) {
			values.put(setting.key(), shown(setting, values));
		}
		return values;
	}

	private String shown(Setting setting, Map<String, String> stored) {
		String value = Condition.valueOf(stored, setting.key());
		EarthProperty property = setting.getProperty();
		if (property == EarthProperty.VIEWER_TYPE) {
			return properties.getViewerType();
		} else if (property == EarthProperty.WINDOW_LAYOUT) {
			return properties.getWindowLayout();
		} else if (property == EarthProperty.MAP_ENGINE) {
			return properties.getMapEngine();
		} else if (property == EarthProperty.WEB_FORM) {
			return properties.getWebForm();
		} else if (property == EarthProperty.DB_DRIVER) {
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
		return validator.validate(overlay(current(), given));
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
		Map<String, String> merged = overlay(current(), changes);
		Validation validation = validator.validate(merged);
		if (!validation.isValid()) {
			throw new InvalidSettingsException(validation.getErrors());
		}
		Map<String, String> toWrite = new LinkedHashMap<>();
		boolean restartNeeded = false;
		for (Setting setting : getModel().settings()) {
			String key = setting.key();
			String value;
			if (setting.isVisible(merged)) {
				if (!changes.containsKey(key)) {
					continue;
				}
				value = setting.getType() == Type.PASSWORD ? changes.get(key) : StringUtils.trimToEmpty(changes.get(key));
			} else if (setting.isBlankWhenHidden()) {
				value = "";
			} else {
				continue;
			}
			if (value.equals(properties.getValue(setting.getProperty()))) {
				continue;
			}
			toWrite.put(key, value);
			restartNeeded |= setting.isRestart();
		}
		if (toWrite.isEmpty()) {
			return false;
		}
		properties.setValues(toWrite);
		if (restartNeeded) {
			restart.run();
		} else {
			reload.run();
		}
		return restartNeeded;
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
