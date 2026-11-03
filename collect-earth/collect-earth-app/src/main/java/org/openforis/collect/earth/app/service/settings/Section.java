package org.openforis.collect.earth.app.service.settings;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A section of the settings page: its id, its label (a key of Messages.properties), a hint shown over its settings, and them. */
public final class Section {

	private final String id;
	private final String label;
	private final String hint;
	private final List<Setting> settings;

	public Section(String id, String label, String hint, Setting... settings) {
		this.id = id;
		this.label = label;
		this.hint = hint;
		this.settings = Collections.unmodifiableList(new ArrayList<>(Arrays.asList(settings)));
	}

	public Section(String id, String label, Setting... settings) {
		this(id, label, null, settings);
	}

	public String getId() {
		return id;
	}

	public String getLabel() {
		return label;
	}

	/** The key of the hint, or null */
	public String getHint() {
		return hint;
	}

	public List<Setting> getSettings() {
		return settings;
	}

	public Map<String, Object> toJson() {
		Map<String, Object> json = new LinkedHashMap<>();
		json.put("id", id);
		json.put("label", label);
		json.put("hint", hint);
		List<Map<String, Object>> fields = new ArrayList<>();
		for (Setting setting : settings) {
			fields.add(setting.toJson());
		}
		json.put("fields", fields);
		return json;
	}
}
