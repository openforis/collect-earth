package org.openforis.collect.earth.ipcc.model;

public enum ClimateTypeEnum {
	TRW("Tropical Wet", 1, "Tropical", 1), 
	TMM("Tropical Moist", 2, "Tropical",1),
	TRD("Tropical Dry", 4, "Tropical",1),
	TRMT("Tropical Montane Moist", 5, "Tropical",1),
	TRMTD("Tropical Montane Dry", 6, "Tropical",1),
	
	WTM("Warm Temperate Moist", 7, "Subtropical(Mediterranean)",2),
	WTD("Warm Temperate Dry", 8, "Subtropical(Mediterranean)", 2),
	
	CTM("Cool Temperate Moist", 9, "Temperate", 3),
	CTD("Cool Temperate Dry", 10, "Temperate", 3),
	
	BOM("Boreal Moist", 11, "Boreal", 4),
	BOD("Boreal Dry", 12, "Boreal", 4),
	
	POM("Polar Moist", 13, "Polar", 5),
	POD("Polar Dry", 14, "Polar", 5);
	
	private final String name;
	private int id;
	private String domainName;
	private int domainId;
	
	private ClimateTypeEnum(String name, int id, String domainName, int domainId) {
        this.name = name;
        this.id = id;
        this.domainName = domainName;
        this.domainId = domainId;
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

	public int getDomainId() {
		return domainId;
	}

	public String getDomainName() {
		return domainName;
	}

}
