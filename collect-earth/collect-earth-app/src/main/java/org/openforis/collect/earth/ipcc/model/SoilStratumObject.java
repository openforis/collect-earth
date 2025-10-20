package org.openforis.collect.earth.ipcc.model;

public class SoilStratumObject extends StratumObject{

	private SoilTypeEnum soilType;
	
	public static SoilStratumObject NODATA = getNoDataSoilStratumObject();
	
	private static SoilStratumObject getNoDataSoilStratumObject() {
		return new SoilStratumObject(SoilTypeEnum.NO_DATA.getName(), "NO_DATA", "No Data");
	}

	public SoilStratumObject(String value, String label , String description ) {
		super(value, label, description);
		// Map the soil acronym to the SoilTypeEnum with the domain ID and ID used in the GHGi tool
		this.soilType = SoilTypeEnum.valueOf( label); 	
	}

	public SoilTypeEnum getSoilType() {
		return soilType;
	}

	@Override
	public String toString() {
		return "SoilStratumObject [soilType=" + soilType + ",  label= " + label +" ]";
	}
	

}
