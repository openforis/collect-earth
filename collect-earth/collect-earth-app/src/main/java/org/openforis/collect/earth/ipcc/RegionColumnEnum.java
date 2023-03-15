package org.openforis.collect.earth.ipcc;

public enum RegionColumnEnum {

	COUNTRY( "country" ), PROVINCE("province"), DISTRICT("district");
	
	private String columnName;

	private int id;

	private RegionColumnEnum(String columnName) {
		this.columnName = columnName;
	}

	public String getColumnName() {
		return columnName;
	}
}
