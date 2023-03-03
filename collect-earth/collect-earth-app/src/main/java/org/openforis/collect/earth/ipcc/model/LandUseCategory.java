package org.openforis.collect.earth.ipcc.model;

public enum LandUseCategory {
	F ("F", "Forest", 1), 
	C ("C", "Cropland", 2), 
	S ("S", "Settlement", 3), 
	W ("W", "Wetland", 4), 
	G ("G","Grassland", 5), 
	O ("O", "Otherland", 6);
	
	private final String code;
	private final String name;
	private final Integer id;

    private LandUseCategory(String code, String name, Integer id) {
        this.code = code;
        this.name = name;
        this.id = id;
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

	public Integer getId() {
		return id;
	}
	
}
