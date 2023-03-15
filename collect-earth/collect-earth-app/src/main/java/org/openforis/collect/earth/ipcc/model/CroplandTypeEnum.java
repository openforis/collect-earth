package org.openforis.collect.earth.ipcc.model;

public enum CroplandTypeEnum {

	ANNUAL("Annual"),PERENNIAL("Perennial");
	
	public final String name;
	
	private CroplandTypeEnum(String name) {
        this.name = name;
    }

	public String getName() {
		return name;
	}

	@Override
	public String toString() {
		return getName();
	}
}
