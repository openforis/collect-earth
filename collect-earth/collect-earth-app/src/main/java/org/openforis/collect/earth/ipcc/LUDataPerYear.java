package org.openforis.collect.earth.ipcc;

import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;

public class LUDataPerYear<F,E> {

	private LandUseSubdivision lu;
	private LandUseSubdivision luNextYear;
	private double areaHa;
	
	public LUDataPerYear(LandUseSubdivision lu, LandUseSubdivision luNextYear, double areaHa) {
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





	public LandUseSubdivision<F> getLu() {
		return lu;
	}





	public LandUseSubdivision<E> getLuNextYear() {
		return luNextYear;
	}





	public void setLu(LandUseSubdivision<F> lu) {
		this.lu = lu;
	}





	public void setLuNextYear(LandUseSubdivision<E> luNextYear) {
		this.luNextYear = luNextYear;
	}

}
