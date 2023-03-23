package org.openforis.collect.earth.ipcc.model;

public enum PerennialCropTypesEnum {
	
	ALL( 1,"All perennials"),
	AGROSILVOCULTURAL( 2,"Agrosilvicultural"),
	SILVOPASTORAL( 3, "Silvopastoral"),
	OIL_PALM( 4,"Oil Palm"),
	MATURE_RUBBER( 5,"Mature rubber"),
	YOUUNG_RUBBER( 6, "Young rubber"),
	CINNAMON( 7,"Young cinnamon"),
	COCONUT( 8, "Coconut"),
	IMPROVED_FALLOW( 9, "Improved fallow"),
	ALLEY_CROPPING( 10, "Alley cropping"),
	MULTISTOREY( 11, "Multistorey system"),
	USER( 12, "User-defined");
	
	private final String name;
	private int id;
	
	private PerennialCropTypesEnum( int id, String name) {
        this.name = name;
        this.id = id;
    }

	@Override
	public String toString() {
		return getName();
	}

	public String getName() {
		return name;
	}

	public int getId() {
		return id;
	}

}
