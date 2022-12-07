package org.openforis.collect.earth.ipcc;

import org.apache.commons.lang3.ArrayUtils;

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


	public String getClimate() {
		return climate;
	}


	public String getSoil() {
		return soil;
	}


	public String getGez() {
		return gez;
	}


	public void setClimate(String climate) {
		this.climate = climate;
	}


	public void setSoil(String soil) {
		this.soil = soil;
	}


	public void setGez(String gez) {
		this.gez = gez;
	}

}
