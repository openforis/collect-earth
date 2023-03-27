package org.openforis.collect.earth.ipcc.model;

public enum ClimateTypeEnum {
	TRW("Tropical Wet", 1, ClimateDomainEnum.TROPICAL), 
	TMM("Tropical Moist", 2, ClimateDomainEnum.TROPICAL),
	TRD("Tropical Dry", 4, ClimateDomainEnum.TROPICAL),
	TRMT("Tropical Montane Moist", 5, ClimateDomainEnum.TROPICAL),
	TRMTD("Tropical Montane Dry", 6, ClimateDomainEnum.TROPICAL),
	
	WTM("Warm Temperate Moist", 7, ClimateDomainEnum.MEDITERRANEAN),
	WTD("Warm Temperate Dry", 8, ClimateDomainEnum.MEDITERRANEAN),
	
	CTM("Cool Temperate Moist", 9, ClimateDomainEnum.TEMPERATE),
	CTD("Cool Temperate Dry", 10, ClimateDomainEnum.TEMPERATE),
	
	BOM("Boreal Moist", 11, ClimateDomainEnum.BOREAL),
	BOD("Boreal Dry", 12, ClimateDomainEnum.BOREAL),
	
	POM("Polar Moist", 13, ClimateDomainEnum.POLAR),
	POD("Polar Dry", 14, ClimateDomainEnum.POLAR);
	
	private final String name;
	private int id;
	private ClimateDomainEnum climateDomain;
	
	private ClimateTypeEnum(String name, int id, ClimateDomainEnum climateDomain) {
        this.name = name;
        this.id = id;
        this.climateDomain = climateDomain;
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

	public ClimateDomainEnum getClimateDomain() {
		return climateDomain;
	}

}
