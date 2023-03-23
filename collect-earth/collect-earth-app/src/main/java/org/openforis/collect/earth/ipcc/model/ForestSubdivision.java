package org.openforis.collect.earth.ipcc.model;

public class ForestSubdivision extends AbstractManagementLandUseSubdivision{
	
	private ForestTypeEnum forestType;
	
	public ForestTypeEnum getForestType() {
		return forestType;
	}

	public void setForestType(ForestTypeEnum forestType) {
		this.forestType = forestType;
	}

	public ForestSubdivision( String code, String name, ManagementTypeEnum managementType, Integer id, ForestTypeEnum forestType ) {
		super( LandUseCategoryEnum.F, code, name, managementType, id );
		setForestType(forestType);
	}
	
}