package org.openforis.collect.earth.ipcc.model;

public class CroplandSubdivision extends AbstractLandUseSubdivision<CroplandTypeEnum>{
	
	protected CroplandTypeEnum croplandType;
	protected PerennialCropTypesEnum perennialCropType;
	
	public CroplandSubdivision( String code, String name, CroplandTypeEnum type, Integer id) {
		super(LandUseCategoryEnum.C, code, name, id);
		setManagementType(type);
	}

	public CroplandTypeEnum getManagementType() {
		return croplandType;
	}

	public void setManagementType(CroplandTypeEnum croplandType) {
		this.croplandType = croplandType;
	}
	
	public void setPerennialCropType(PerennialCropTypesEnum perennialCropType) {
		this.perennialCropType = perennialCropType;
	}

	public PerennialCropTypesEnum getPerennialCropType() {
		// TODO Auto-generated method stub
		return perennialCropType;
	};
	
}
