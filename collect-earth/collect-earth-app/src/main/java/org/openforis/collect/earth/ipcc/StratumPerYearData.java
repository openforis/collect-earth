package org.openforis.collect.earth.ipcc;

import java.util.List;

import liquibase.repackaged.org.apache.commons.lang3.ArrayUtils;

public class StratumPerYearData {

	private int year;
	private String climate;
	private String soil;
	private String gez;
	private List<LUDataPerYear> luData;
	
	public StratumPerYearData(int year, String climate, String soil, String gez) {
		super();
		this.year = year;
		this.climate = climate;
		this.soil = soil;
		this.gez = gez;
		this.luData = luData;
	}

	public List<LUDataPerYear> getLuData() {
		return luData;
	}

	public void setLuData(List<LUDataPerYear> luData) {
		this.luData = luData;
	}

	@Override
	public String toString() {
		return "StratumPerYearData [year=" + year + ", climate=" + climate + ", soil=" + soil + ", gez=" + gez
				+ ", luData=" + ArrayUtils.toString( luData ) + "]";
	}

}
