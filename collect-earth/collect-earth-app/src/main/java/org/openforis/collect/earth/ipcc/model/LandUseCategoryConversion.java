package org.openforis.collect.earth.ipcc.model;

public class LandUseCategoryConversion {

	private String luInitial;
	private String luFinal;
	private double areaHa;
	private int plotCount;
	
	public LandUseCategoryConversion(String luInitial, String luFinal, double areaHa, int plotCount) {
		super();
		this.luInitial = luInitial;
		this.luFinal = luFinal;
		this.areaHa = areaHa;
		this.plotCount = plotCount;
	}


	public double getAreaHa() {
		return areaHa;
	}


	@Override
	public String toString() {
		return "LU Category conversion [Initial=" + luInitial + ", Final=" + luFinal + ", areaHa=" + areaHa + ", plotCount = " + plotCount +"]";
	}


	public String getLuInitial() {
		return luInitial;
	}


	public String getLuFinal() {
		return luFinal;
	}


	public void setLuInitial(String luInitial) {
		this.luInitial = luInitial;
	}


	public void setLuFinal(String luFinal) {
		this.luFinal = luFinal;
	}


	public void setAreaHa(double areaHa) {
		this.areaHa = areaHa;
	}


	public int getPlotCount() {
		return plotCount;
	}


	public void setPlotCount(int plotCount) {
		this.plotCount = plotCount;
	}


}
