package org.openforis.collect.earth.ipcc.model;

public class CroplandSubdivision extends AbstractLandUseSubdivision<CroplandTypeEnum>{
	
	protected CroplandTypeEnum croplandType;
	protected PerennialCropTypesEnum perennialCropType;
	
	public CroplandSubdivision( String code, String name, CroplandTypeEnum type, Integer id) {
		super(LandUseCategoryEnum.C, code, name, id);
		setManagementType(type);
		this.perennialCropType = PerennialCropTypesEnum.ALL; // As grassland sets its vegetation type : without it a subdivision
		// switched to PERENNIAL without touching its combo reached the export with no crop type and ended it
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
		return perennialCropType;
	};
	
}
