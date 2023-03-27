package org.openforis.collect.earth.ipcc.model;

public enum AgeClassCroplandEnum {
	LESS_THAN_OR_EQUAL_TO_20("≤20 years", 1),
	MORE_THAN_20("> 20 years", 2), 
	UNSPECIFIED( "Unspecified",3),
	USER_DEFINED_RANGE( "User-defined Range",4),
	USER_DEFINED_VALUE( "User-defined Value",5),
	MORE_THAN_AGP( ">AGP",6),
	LESS_THAN_OR_EQUAL_TO_AGP( "≤AGP",7);
	
	private String name;
	private int id;
	
	private AgeClassCroplandEnum(String name, int id) {
        this.name = name;
        this.id = id;
    }

	@Override
	public String toString() {
		return getName();
	}

	public int getId() {
		return id;
	}

	public String getName() {
		return name;
	}

}
