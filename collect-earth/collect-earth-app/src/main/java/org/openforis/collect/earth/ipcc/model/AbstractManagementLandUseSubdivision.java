package org.openforis.collect.earth.ipcc.model;

public abstract class AbstractManagementLandUseSubdivision extends AbstractLandUseSubdivision<ManagementTypeEnum>{

protected ManagementTypeEnum type;
	
	public AbstractManagementLandUseSubdivision( LandUseCategoryEnum category, String code, String name, ManagementTypeEnum type, Integer id) {
		super(category, code, name, id);
		setManagementType(type);
	}

	public ManagementTypeEnum getManagementType() {
		return type;
	}

	public void setManagementType(ManagementTypeEnum type) {
		this.type = type;
	};
	
	
	
}
