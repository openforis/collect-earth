package org.openforis.collect.earth.ipcc.model;

public enum LandUseCategoryEnum {
	F ("F", "Forest", 1), 
	C ("C", "Cropland", 2), 
	G ("G","Grassland", 3), 
	W ("W", "Wetland", 4), 
	S ("S", "Settlement", 5), 
	O ("O", "Otherland", 6);
	
	private final String code;
	private final String name;
	private final Integer id;

    private LandUseCategoryEnum(String code, String name, Integer id) {
        this.code = code;
        this.name = name;
        this.id = id;
    }

    @Override
    public String toString() {
    	return getCode();
    }

    public String getCode() {
		return code;
	}

	public String getName() {
		return name;
	}


	public Integer getId() {
		return id;
	}
	
}
