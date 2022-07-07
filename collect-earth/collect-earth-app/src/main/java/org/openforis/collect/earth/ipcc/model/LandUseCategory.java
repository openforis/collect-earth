package org.openforis.collect.earth.ipcc.model;

public enum LandUseCategory {
	F ( "F", "Forest"), 
	C ("C", "Cropland"), 
	S("S", "Settlement"), 
	W ( "W", "Wetland"), 
	G("G","Grassland"), 
	O( "O", "Otherland");
	
	private final String code;
	private final String name;

    private LandUseCategory(String code, String name) {
        this.code = code;
        this.name = name;
    }

	public String getCode() {
		return code;
	}

	public String getName() {
		return name;
	}

	@Override
	public String toString() {
		return getCode();
	}
}
