package org.openforis.collect.earth.ipcc.model;

public class GrasslandSubdivision extends AbstractManagementLandUseSubdivision{
	
	private VegetationTypeEnum vegetationType;


	public GrasslandSubdivision( String code, String name, ManagementTypeEnum type, Integer id) {
		super( LandUseCategoryEnum.G, code, name, type, id );
		this.vegetationType = VegetationTypeEnum.SV; // Set Savanah as default!
	}
	
	public GrasslandSubdivision( String code, String name, ManagementTypeEnum type, Integer id, VegetationTypeEnum vegetationType) {
		super( LandUseCategoryEnum.G, code, name, type, id );
		this.vegetationType = vegetationType;
	}
	
	public VegetationTypeEnum getVegetationType() {
		return vegetationType;
	}
	
	public void setVegetationType(VegetationTypeEnum vegetationType) {
		this.vegetationType = vegetationType;
	}
}