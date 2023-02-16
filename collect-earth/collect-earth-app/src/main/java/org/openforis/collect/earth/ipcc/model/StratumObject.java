package org.openforis.collect.earth.ipcc.model;

import java.util.UUID;

public class StratumObject {

	String value;
	String label;
	String description;
	String guid;
	

	public StratumObject(String value, String label) {
		super();
		this.value = value;
		this.label = label;
		this.guid = UUID.randomUUID().toString();
	}
	
	public StratumObject(String value, String label, String description) {
		this(value, label);
		this.description = description;
	}
	

	public String getValue() {
		return value;
	}

	public String getLabel() {
		return label;
	}

	public void setValue(String value) {
		this.value = value;
	}

	public void setLabel(String label) {
		this.label = label;
	}

	public String getDescription() {
		return description;
	}

	public void setDescription(String description) {
		this.description = description;
	}

	public String getGuid() {
		return guid;
	}
}
