package org.openforis.collect.earth.planet;

import com.google.gson.annotations.SerializedName;

public enum FilterType {
	@SerializedName("DateRangeFilter") DATERANGE("DateRangeFilter"),
	@SerializedName("StringInFilter") STRING_IN("StringInFilter"),
	@SerializedName("AndFilter") AND("AndFilter"),
	@SerializedName("OrFilter") OR("OrFilter"),
	@SerializedName("GeometryFilter") GEOMETRY("GeometryFilter");

	private String type;

	private FilterType(String type) {
		this.type = type;
	}

	@Override
	public String toString() {
		return type;
	}

}
