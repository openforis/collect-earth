package org.openforis.collect.earth.ipcc;

public enum RegionColumn {

	COUNTRY( "country" ), PROVINCE("province"), DISTRICT("district");
	
	private String columnName;

	private int id;

	private RegionColumn(String columnName) {
		this.columnName = columnName;
	}

	public String getColumnName() {
		return columnName;
	}
}
