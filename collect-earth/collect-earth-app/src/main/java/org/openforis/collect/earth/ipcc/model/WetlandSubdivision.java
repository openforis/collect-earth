package org.openforis.collect.earth.ipcc.model;

public class WetlandSubdivision extends AbstractManagementLandUseSubdivision{
	
	public WetlandSubdivision( String code, String name, ManagementTypeEnum type, Integer id) {
		super( LandUseCategoryEnum.W, code, name, type, id);
	}
	
}
