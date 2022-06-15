package org.openforis.collect.earth.ipcc;

public class LUDataPerYear {

	private String luCat;
	private String luCatNextYear;
	private String luSubdiv;
	private String luSubdivNextYear;
	private double areaHa;
	
	public LUDataPerYear(String luCat, String luCatNextYear, String luSubdiv, String luSubdivNextYear, double areaHa) {
		super();
		this.luCat = luCat;
		this.luCatNextYear = luCatNextYear;
		this.luSubdiv = luSubdiv;
		this.luSubdivNextYear = luSubdivNextYear;
		this.areaHa = areaHa;
	}


	@Override
	public String toString() {
		return "LUDataPerYear [luCat=" + luCat + ", luCatNextYear=" + luCatNextYear + ", luSubdiv=" + luSubdiv
				+ ", luSubdivNextYear=" + luSubdivNextYear + ", areaHa=" + areaHa + "]";
	}
}
