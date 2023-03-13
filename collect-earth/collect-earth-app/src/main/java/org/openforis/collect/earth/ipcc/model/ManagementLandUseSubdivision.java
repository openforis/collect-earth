package org.openforis.collect.earth.ipcc.model;

public abstract class ManagementLandUseSubdivision extends LandUseSubdivision<ManagementType>{

protected ManagementType type;
	
	public ManagementLandUseSubdivision( LandUseCategory category, String code, String name, ManagementType type, Integer id) {
		super(category, code, name, id);
		setManagementType(type);
	}

	public ManagementType getManagementType() {
		return type;
	}

	public void setManagementType(ManagementType type) {
		this.type = type;
	};
	
	
	
}
