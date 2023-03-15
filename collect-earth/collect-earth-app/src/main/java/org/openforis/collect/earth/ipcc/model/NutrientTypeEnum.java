package org.openforis.collect.earth.ipcc.model;

public enum NutrientTypeEnum {
	NOT_RELEVANT("Relevant only in case of Organic soils. Should be -1 otherwise", -1), 
	POOR("Poor", 1), 
	RICH("Rich", 2),
	UNSPECIFIED("Unspecified", 3);
	
	private final String name;
	private int id;
	
	private NutrientTypeEnum(String name, int id) {
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
