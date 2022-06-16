package org.openforis.collect.earth.ipcc;

import liquibase.repackaged.org.apache.commons.lang3.ArrayUtils;

public class StratumPerYearData extends YearData{

	private String climate;
	private String soil;
	private String gez;
	public StratumPerYearData(int year, String climate, String soil, String gez) {
		super(year);
		this.climate = climate;
		this.soil = soil;
		this.gez = gez;
	}


	@Override
	public String toString() {
		return "StratumPerYearData [year=" + year + ", climate=" + climate + ", soil=" + soil + ", gez=" + gez
				+ ", luData=" + ArrayUtils.toString( luData ) + "]";
	}

}
