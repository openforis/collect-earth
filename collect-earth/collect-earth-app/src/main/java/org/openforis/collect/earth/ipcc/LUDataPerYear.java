package org.openforis.collect.earth.ipcc;

import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;

public class LUDataPerYear<F,E> {

	private AbstractLandUseSubdivision lu;
	private AbstractLandUseSubdivision luNextYear;
	private double areaHa;
	
	public LUDataPerYear(AbstractLandUseSubdivision lu, AbstractLandUseSubdivision luNextYear, double areaHa) {
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





	public AbstractLandUseSubdivision<F> getLu() {
		return lu;
	}





	public AbstractLandUseSubdivision<E> getLuNextYear() {
		return luNextYear;
	}





	public void setLu(AbstractLandUseSubdivision<F> lu) {
		this.lu = lu;
	}





	public void setLuNextYear(AbstractLandUseSubdivision<E> luNextYear) {
		this.luNextYear = luNextYear;
	}

}
