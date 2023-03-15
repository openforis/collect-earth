package org.openforis.collect.earth.ipcc.model;

public enum SoilTypeEnum {
	HAC("High Activity Clay", 1, "Mineral", 1), 
	LAC("Low Activity Clay", 2, "Mineral", 1), 
	VOL("Volcanic", 3, "Mineral", 1), 
	SPO("Spodic", 4, "Mineral", 1), 
	SAN("Sandy", 5, "Mineral", 1), 
	WET("Wetland", 6, "Mineral", 1), 
	
	ORG("Organic", 7, "Organic", 2),
	
	OtherAreas("Coastal Wetlands soil", 7, "Mixed", 3);
	
	private final String name;
	private int id;
	private String soilCompositionName;
	private int soilCompositionId;
	
	private SoilTypeEnum(String name, int id, String soilCompositionName, int soilCompositionId) {
        this.name = name;
        this.id = id;
        this.soilCompositionName = soilCompositionName;
        this.soilCompositionId = soilCompositionId;
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

	public int getSoilCompositionId() {
		return soilCompositionId;
	}

	public String getSoilCompositionName() {
		return soilCompositionName;
	}

}
