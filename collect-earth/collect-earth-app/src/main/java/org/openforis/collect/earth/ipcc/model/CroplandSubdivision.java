package org.openforis.collect.earth.ipcc.model;

public class CroplandSubdivision extends LandUseSubdivision<CroplandType>{
	
	protected CroplandType type;
	
	public CroplandSubdivision( String code, String name, CroplandType type, Integer id) {
		super(LandUseCategory.C, code, name, id);
		setManagementType(type);
	}

	public CroplandType getManagementType() {
		return type;
	}

	public void setManagementType(CroplandType type) {
		this.type = type;
	};
	
}
