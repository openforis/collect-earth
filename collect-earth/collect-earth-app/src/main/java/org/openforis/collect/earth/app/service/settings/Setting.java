package org.openforis.collect.earth.app.service.settings;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

/**
 * One setting of the settings page: the property it is stored in, its type, its texts (keys of Messages.properties),
 * when it is shown, whether changing it restarts Collect Earth, and its rules. The page draws the field from the JSON
 * of toJson() (the Field of settings.ts); the server validates and saves from the same description. Built with the
 * static factories and the chained setters, as the sections of SettingsModel do.
 */
public final class Setting {

	public enum Type {
		TEXT, PASSWORD, INTEGER, BOOLEAN, CHOICE, FILE, FOLDER, DATE;

		String json() {
			return name().toLowerCase(Locale.ENGLISH);
		}
	}

	/** A rule of a setting: the message (in the UI language) when the value breaks it, null when it does not. */
	public interface Rule {
		String check(String value, Map<String, String> values);
	}

	/**
	 * An entry of a choice: its stored value, its label as a key of Messages.properties or as a plain text, and for a
	 * few a description, a key too, which the page shows under the field while the entry is chosen.
	 */
	public static final class Choice {
		final String value;
		final String label;
		final String text;
		final String description;

		Choice(String value, String label, String text, String description) {
			this.value = value;
			this.label = label;
			this.text = text;
			this.description = description;
		}

		public String getValue() {
			return value;
		}

		/** The key of the label, null for a choice labelled with a plain text */
		public String getLabel() {
			return label;
		}

		/** The key of the description, null for most */
		public String getDescription() {
			return description;
		}

		Map<String, Object> toJson() {
			Map<String, Object> json = new LinkedHashMap<>();
			json.put("value", value);
			if (label != null) {
				json.put("label", label);
			} else {
				json.put("text", text);
			}
			if (description != null) {
				json.put("description", description);
			}
			return json;
		}
	}

	private static final class ConditionalLabel {
		final Condition when;
		final String label;

		ConditionalLabel(Condition when, String label) {
			this.when = when;
			this.label = label;
		}
	}

	private final EarthProperty property;
	private final Type type;
	private final String label;
	private String tooltip;
	private String defaultValue = "";
	private boolean restart;
	private boolean required;
	private boolean blankWhenHidden;
	private Condition visible;
	private final List<ConditionalLabel> labels = new ArrayList<>();
	private final List<Choice> choices = new ArrayList<>();
	private List<String> extensions = Collections.emptyList();
	private Integer min;
	private Integer max;
	private final List<Rule> errors = new ArrayList<>();
	private final List<Rule> warnings = new ArrayList<>();

	private Setting(EarthProperty property, Type type, String label) {
		this.property = property;
		this.type = type;
		this.label = label;
	}

	public static Setting text(EarthProperty property, String label) {
		return new Setting(property, Type.TEXT, label);
	}

	public static Setting password(EarthProperty property, String label) {
		return new Setting(property, Type.PASSWORD, label);
	}

	/** A whole number within the range, which the page offers as a number field and the server checks. */
	public static Setting integer(EarthProperty property, String label, int min, int max) {
		Setting setting = new Setting(property, Type.INTEGER, label);
		setting.min = min;
		setting.max = max;
		return setting;
	}

	/** Stored as "true" or "false". */
	public static Setting bool(EarthProperty property, String label) {
		return new Setting(property, Type.BOOLEAN, label);
	}

	/** One of the options added with option() or optionText(). */
	public static Setting choice(EarthProperty property, String label) {
		return new Setting(property, Type.CHOICE, label);
	}

	/** A path to a file with one of these extensions, which the page lets the user browse for. */
	public static Setting file(EarthProperty property, String label, String... extensions) {
		Setting setting = new Setting(property, Type.FILE, label);
		setting.extensions = Collections.unmodifiableList(Arrays.asList(extensions));
		return setting;
	}

	public static Setting folder(EarthProperty property, String label) {
		return new Setting(property, Type.FOLDER, label);
	}

	/** A date as yyyy-MM-dd, or blank. */
	public static Setting date(EarthProperty property, String label) {
		return new Setting(property, Type.DATE, label);
	}

	public Setting tooltip(String tooltip) {
		this.tooltip = tooltip;
		return this;
	}

	/** The value Restore defaults sets; blank when not given. */
	public Setting defaultValue(String defaultValue) {
		this.defaultValue = defaultValue;
		return this;
	}

	/** Changing it restarts Collect Earth, as only a new server reads it. */
	public Setting restart() {
		this.restart = true;
		return this;
	}

	/** A blank value is refused (PropertyValidators.required) while the setting is shown. */
	public Setting required() {
		this.required = true;
		return this;
	}

	/** Shown only while the condition holds; always, without one. */
	public Setting visibleWhen(Condition condition) {
		this.visible = condition;
		return this;
	}

	/** Another label while the condition holds, checked in the order given before the plain label. */
	public Setting labelWhen(Condition condition, String label) {
		labels.add(new ConditionalLabel(condition, label));
		return this;
	}

	/**
	 * Saved blank while hidden, instead of keeping its value: for the few settings the KML generators read whatever the
	 * plot shape, so a value of another shape is not drawn into this one.
	 */
	public Setting blankWhenHidden() {
		this.blankWhenHidden = true;
		return this;
	}

	public Setting option(String value, String label) {
		choices.add(new Choice(value, label, null, null));
		return this;
	}

	/** An option with a description shown under the field while it is chosen. */
	public Setting option(String value, String label, String description) {
		choices.add(new Choice(value, label, null, description));
		return this;
	}

	public Setting option(Enum<?> value, String label) {
		return option(value.name(), label);
	}

	/** An option whose label is no text of Messages.properties, such as a month. */
	public Setting optionText(String value, String text) {
		choices.add(new Choice(value, null, text, null));
		return this;
	}

	/** A rule whose breach is an error: the setting cannot be saved until it holds. */
	public Setting error(Rule rule) {
		errors.add(rule);
		return this;
	}

	/** A rule whose breach is only shown. */
	public Setting warn(Rule rule) {
		warnings.add(rule);
		return this;
	}

	public EarthProperty getProperty() {
		return property;
	}

	/** The name of the property, the key of the value in earth.properties and in the API. */
	public String key() {
		return property.toString();
	}

	public Type getType() {
		return type;
	}

	public String getLabel() {
		return label;
	}

	public String getTooltip() {
		return tooltip;
	}

	public String getDefaultValue() {
		return defaultValue;
	}

	public boolean isRestart() {
		return restart;
	}

	public boolean isRequired() {
		return required;
	}

	public boolean isBlankWhenHidden() {
		return blankWhenHidden;
	}

	public List<Choice> getChoices() {
		return Collections.unmodifiableList(choices);
	}

	public Integer getMin() {
		return min;
	}

	public Integer getMax() {
		return max;
	}

	public List<Rule> getErrorRules() {
		return Collections.unmodifiableList(errors);
	}

	public List<Rule> getWarningRules() {
		return Collections.unmodifiableList(warnings);
	}

	/** The keys of the labels this setting may show: its own and the conditional ones. */
	public List<String> labelKeys() {
		List<String> keys = new ArrayList<>();
		keys.add(label);
		for (ConditionalLabel conditional : labels) {
			keys.add(conditional.label);
		}
		return keys;
	}

	public boolean isVisible(Map<String, String> values) {
		return visible == null || visible.holds(values);
	}

	/** The label for these values: the first conditional one that holds, else the plain one. */
	public String label(Map<String, String> values) {
		for (ConditionalLabel conditional : labels) {
			if (conditional.when.holds(values)) {
				return conditional.label;
			}
		}
		return label;
	}

	public Map<String, Object> toJson() {
		Map<String, Object> json = new LinkedHashMap<>();
		json.put("key", key());
		json.put("type", type.json());
		json.put("label", label);
		json.put("tooltip", tooltip);
		json.put("default", defaultValue);
		json.put("restart", restart);
		json.put("required", required);
		if (visible != null) {
			json.put("visible", visible.toJson());
		}
		if (!labels.isEmpty()) {
			List<Map<String, Object>> conditionals = new ArrayList<>();
			for (ConditionalLabel conditional : labels) {
				Map<String, Object> entry = new LinkedHashMap<>();
				entry.put("when", conditional.when.toJson());
				entry.put("label", conditional.label);
				conditionals.add(entry);
			}
			json.put("labels", conditionals);
		}
		if (type == Type.INTEGER) {
			json.put("min", min);
			json.put("max", max);
		}
		if (type == Type.CHOICE) {
			List<Map<String, Object>> options = new ArrayList<>();
			for (Choice choice : choices) {
				options.add(choice.toJson());
			}
			json.put("choices", options);
		}
		if (type == Type.FILE) {
			json.put("extensions", extensions);
		}
		return json;
	}
}
