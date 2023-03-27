package org.openforis.collect.earth.ipcc.model;

public enum GrowingStockLevelEnum {
	BOREAL_LESS_20("<20", 1, ClimateDomainEnum.BOREAL),
	BOREAL_21_50("21-50", 2, ClimateDomainEnum.BOREAL),
	BOREAL_51_100("51-100", 3, ClimateDomainEnum.BOREAL), 
	BOREAL_MORE_100(">100", 4, ClimateDomainEnum.BOREAL),
	
	TEMPERATE_LESS_20("<20", 30, ClimateDomainEnum.TEMPERATE),
	TEMPERATE_21_40("21-40", 6, ClimateDomainEnum.TEMPERATE),
	TEMPERATE_41_100("41-100", 7, ClimateDomainEnum.TEMPERATE),
	TEMPERATE_101_200("101-200", 8, ClimateDomainEnum.TEMPERATE),
	TEMPERATE_MORE_200(">200", 9, ClimateDomainEnum.TEMPERATE),
	
	MEDITERRANEAN__LESS_20("<20", 31, ClimateDomainEnum.MEDITERRANEAN),
	MEDITERRANEAN__21_40("21-40", 32, ClimateDomainEnum.MEDITERRANEAN),
	MEDITERRANEAN__41_80("41-80", 12, ClimateDomainEnum.MEDITERRANEAN),
	MEDITERRANEAN__MORE_80(">80", 13, ClimateDomainEnum.MEDITERRANEAN),
	
	TROPICAL_LESS_10("<10", 22, ClimateDomainEnum.TROPICAL),
	TROPICAL_10_20("10-20", 23, ClimateDomainEnum.TROPICAL),
	TROPICAL_21_40("21-40", 33, ClimateDomainEnum.TROPICAL),
	TROPICAL_41_60("41-60", 25, ClimateDomainEnum.TROPICAL),
	TROPICAL_61_80("61-80", 26, ClimateDomainEnum.TROPICAL),
	TROPICAL_81_120("81-120", 27, ClimateDomainEnum.TROPICAL),
	TROPICAL_121_200("121-200", 28, ClimateDomainEnum.TROPICAL),
	TROPICAL_MORE_200(">200", 34, ClimateDomainEnum.TROPICAL);
	
	
	private String name;
	private int id;
	private ClimateDomainEnum climateDomain;


	private GrowingStockLevelEnum(String name, int id, ClimateDomainEnum climateDomain) {
		this.name = name;
		this.id = id;
		this.climateDomain = climateDomain;
        
    }

	@Override
	public String toString() {
		return getName();
	}

	public ClimateDomainEnum getClimateDomain() {
		return climateDomain;
	}

	public String getName() {
		return name;
	}

	public int getId() {
		return id;
	}

	

}
