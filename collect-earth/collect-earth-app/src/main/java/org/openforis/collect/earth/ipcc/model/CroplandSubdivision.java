package org.openforis.collect.earth.ipcc.model;

public class CroplandSubdivision extends AbstractLandUseSubdivision<CroplandTypeEnum>{
	
	protected CroplandTypeEnum type;
	
	public CroplandSubdivision( String code, String name, CroplandTypeEnum type, Integer id) {
		super(LandUseCategoryEnum.C, code, name, id);
		setManagementType(type);
	}

	public CroplandTypeEnum getManagementType() {
		return type;
	}

	public void setManagementType(CroplandTypeEnum type) {
		this.type = type;
	};
	
}
