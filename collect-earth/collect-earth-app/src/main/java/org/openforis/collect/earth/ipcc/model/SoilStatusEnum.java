package org.openforis.collect.earth.ipcc.model;

public enum SoilStatusEnum {
	NATURAL("Natural", 1), 
	DRAINED("Drained", 2),
	REWETTED("Rewetted", 3),
	NOT_APPLICABLE("Not Applicable", 4),
	EXCAVATED("Excavated", 5);
	
	private final String name;
	private int id;
	
	private SoilStatusEnum(String name, int id) {
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
