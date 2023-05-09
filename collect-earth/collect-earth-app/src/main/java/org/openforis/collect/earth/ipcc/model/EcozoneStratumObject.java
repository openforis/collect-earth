package org.openforis.collect.earth.ipcc.model;

public class EcozoneStratumObject extends StratumObject{

	private EcozoneTypeEnum ecozoneType;

	public EcozoneStratumObject(String value, String label , String description ) {
		super(value, label, description);
		// Map the climate acronym to the ClimateTypeEnum with the domain ID and ID used in the GHGi tool
		this.ecozoneType = EcozoneTypeEnum.valueOf( label); 	
	}

	public EcozoneTypeEnum getEcozoneType() {
		return ecozoneType;
	}

	@Override
	public String toString() {
		return "EcozoneStratumObject [ecozoneType=" + ecozoneType + ",  label= " + label +" ]";
	}

}
