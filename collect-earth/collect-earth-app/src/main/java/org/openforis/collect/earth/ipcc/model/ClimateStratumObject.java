package org.openforis.collect.earth.ipcc.model;

public class ClimateStratumObject extends StratumObject{

	private ClimateTypeEnum climateType;

	public ClimateStratumObject(String value, String label, String description ) {
		super(value, label, description);
		// Map the climate acronym to the ClimateTypeEnum with the domain ID and ID used in the GHGi tool
		this.climateType = ClimateTypeEnum.valueOf( label); 	
	}

	public ClimateTypeEnum getClimateType() {
		return climateType;
	}

}
