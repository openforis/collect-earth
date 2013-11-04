package org.openforis.collect.earth.sampler.model;

public enum AspectCode {
	N("North"),NE("North-East"),E("East"),SE("South-East"),S("South"),SW("South-West"),W("West"),NW("North-West");
	private String label;
	private AspectCode(String label ) {
		this.label = label;
	}
	@Override
	public String toString() {
		return label;
	}
	
	public String getLabel() {
		return label;
	}
	
}
