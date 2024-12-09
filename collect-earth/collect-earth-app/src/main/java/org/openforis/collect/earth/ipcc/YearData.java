package org.openforis.collect.earth.ipcc;

import java.util.List;

public class YearData {

	protected int year;
	protected List<LUSubdivisionDataPerYear> luData;

	public YearData(int year) {
		super();
		this.year = year;
	}
	
	public YearData(int year, List<LUSubdivisionDataPerYear> luData) {
		super();
		this.year = year;
		this.luData = luData;
	}
	
	public List<LUSubdivisionDataPerYear> getLuData() {
		return luData;
	}

	public void setLuData(List<LUSubdivisionDataPerYear> luData) {
		this.luData = luData;
	}

	public int getYear() {
		return year;
	}
}
