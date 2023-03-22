package org.openforis.collect.earth.ipcc.model;

public class SoilStratumObject extends StratumObject{

	private SoilTypeEnum soilType;

	public SoilStratumObject(String value, String label , String description ) {
		super(value, label, description);
		// Map the climate acronym to the ClimateTypeEnum with the domain ID and ID used in the GHGi tool
		this.soilType = SoilTypeEnum.valueOf( label); 	
	}

	public SoilTypeEnum getSoilType() {
		return soilType;
	}

}
