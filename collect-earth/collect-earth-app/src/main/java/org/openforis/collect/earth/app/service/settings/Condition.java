package org.openforis.collect.earth.app.service.settings;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

/**
 * When a setting is shown, as data: the page evaluates it on every change (holds() in settings.ts), so the fields of a
 * plot shape appear as the user picks it, and the server evaluates it too, to validate and save only the settings that
 * are shown. Both read the same JSON (toJson): {"key", "in": [...]}, {"key", "min": n}, {"key", "notBlank": true},
 * {"all": [...]}, {"any": [...]} and {"not": {...}}. A value that is not there counts as blank.
 */
public abstract class Condition {

	/** Whether the condition holds for these values (by property name, as earth.properties holds them). */
	public abstract boolean holds(Map<String, String> values);

	public abstract Map<String, Object> toJson();

	/** The value is one of these. */
	public static Condition in(EarthProperty property, String... values) {
		return new In(property.toString(), Arrays.asList(values));
	}

	/** The value is one of the names of these constants (the shapes are stored by name). */
	public static Condition in(EarthProperty property, Enum<?>... values) {
		List<String> names = new ArrayList<>();
		for (Enum<?> value : values) {
			names.add(value.name());
		}
		return new In(property.toString(), names);
	}

	/** The value is a whole number of at least this; blank or not a number never is. */
	public static Condition atLeast(EarthProperty property, int minimum) {
		return new AtLeast(property.toString(), minimum);
	}

	public static Condition notBlank(EarthProperty property) {
		return new NotBlank(property.toString());
	}

	public static Condition all(Condition... conditions) {
		return new All(Arrays.asList(conditions));
	}

	public static Condition any(Condition... conditions) {
		return new Any(Arrays.asList(conditions));
	}

	public static Condition not(Condition condition) {
		return new Not(condition);
	}

	static String valueOf(Map<String, String> values, String key) {
		String value = values.get(key);
		return value == null ? "" : value;
	}

	private static final class In extends Condition {
		private final String key;
		private final List<String> values;

		In(String key, List<String> values) {
			this.key = key;
			this.values = Collections.unmodifiableList(new ArrayList<>(values));
		}

		@Override
		public boolean holds(Map<String, String> values) {
			return this.values.contains(valueOf(values, key));
		}

		@Override
		public Map<String, Object> toJson() {
			Map<String, Object> json = new LinkedHashMap<>();
			json.put("key", key);
			json.put("in", values);
			return json;
		}
	}

	private static final class AtLeast extends Condition {
		private final String key;
		private final int minimum;

		AtLeast(String key, int minimum) {
			this.key = key;
			this.minimum = minimum;
		}

		@Override
		public boolean holds(Map<String, String> values) {
			try {
				return Integer.parseInt(valueOf(values, key).trim()) >= minimum;
			} catch (NumberFormatException e) {
				return false;
			}
		}

		@Override
		public Map<String, Object> toJson() {
			Map<String, Object> json = new LinkedHashMap<>();
			json.put("key", key);
			json.put("min", minimum);
			return json;
		}
	}

	private static final class NotBlank extends Condition {
		private final String key;

		NotBlank(String key) {
			this.key = key;
		}

		@Override
		public boolean holds(Map<String, String> values) {
			return StringUtils.isNotBlank(valueOf(values, key));
		}

		@Override
		public Map<String, Object> toJson() {
			Map<String, Object> json = new LinkedHashMap<>();
			json.put("key", key);
			json.put("notBlank", true);
			return json;
		}
	}

	private static final class All extends Condition {
		private final List<Condition> conditions;

		All(List<Condition> conditions) {
			this.conditions = conditions;
		}

		@Override
		public boolean holds(Map<String, String> values) {
			for (Condition condition : conditions) {
				if (!condition.holds(values)) {
					return false;
				}
			}
			return true;
		}

		@Override
		public Map<String, Object> toJson() {
			return Collections.singletonMap("all", jsonOf(conditions));
		}
	}

	private static final class Any extends Condition {
		private final List<Condition> conditions;

		Any(List<Condition> conditions) {
			this.conditions = conditions;
		}

		@Override
		public boolean holds(Map<String, String> values) {
			for (Condition condition : conditions) {
				if (condition.holds(values)) {
					return true;
				}
			}
			return false;
		}

		@Override
		public Map<String, Object> toJson() {
			return Collections.singletonMap("any", jsonOf(conditions));
		}
	}

	private static final class Not extends Condition {
		private final Condition condition;

		Not(Condition condition) {
			this.condition = condition;
		}

		@Override
		public boolean holds(Map<String, String> values) {
			return !condition.holds(values);
		}

		@Override
		public Map<String, Object> toJson() {
			return Collections.singletonMap("not", condition.toJson());
		}
	}

	private static List<Map<String, Object>> jsonOf(List<Condition> conditions) {
		List<Map<String, Object>> json = new ArrayList<>();
		for (Condition condition : conditions) {
			json.add(condition.toJson());
		}
		return json;
	}
}
