package org.openforis.collect.earth.ipcc.model;

public class StratumObject {

	String value;
	String label;

	public StratumObject(String value, String label) {
		super();
		this.value = value;
		this.label = label;
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
	
	
	
}
