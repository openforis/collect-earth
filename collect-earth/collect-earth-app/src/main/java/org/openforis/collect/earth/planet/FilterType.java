package org.openforis.collect.earth.planet;

public enum FilterType {
	DATERANGE("DateRangeFilter"),
	STRING_IN("StringInFilter"),
	AND("AndFilter"),
	GEOMETRY("GeometryFilter");

	private String type;

	private FilterType(String type) {
		this.type = type;
	}

	@Override
	public String toString() {
		return type;
	}

}
