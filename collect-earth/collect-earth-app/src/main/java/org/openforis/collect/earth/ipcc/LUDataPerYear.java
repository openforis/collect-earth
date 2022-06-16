package org.openforis.collect.earth.ipcc;

public class LUDataPerYear {

	private LUSubdivision lu;
	private LUSubdivision luNextYear;
	private double areaHa;
	
	public LUDataPerYear(LUSubdivision lu, LUSubdivision luNextYear, double areaHa) {
		super();
		this.lu = lu;
		this.luNextYear = luNextYear;
		this.areaHa = areaHa;
	}


	public double getAreaHa() {
		return areaHa;
	}


	@Override
	public String toString() {
		return "LUDataPerYear [lu=" + lu + ", luNextYear=" + luNextYear + ", areaHa=" + areaHa + "]";
	}





	public LUSubdivision getLu() {
		return lu;
	}





	public LUSubdivision getLuNextYear() {
		return luNextYear;
	}





	public void setLu(LUSubdivision lu) {
		this.lu = lu;
	}





	public void setLuNextYear(LUSubdivision luNextYear) {
		this.luNextYear = luNextYear;
	}

}
