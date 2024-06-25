package org.openforis.collect.earth.ipcc.model;

public enum ClimateDomainEnum {
	TROPICAL("Tropical", 1), 
	MEDITERRANEAN( "Subtropical(Mediterranean)",2),
	TEMPERATE("Temperate", 3),
	BOREAL( "Boreal", 4),
	POLAR("Polar", 5),
	NO_DATA("NO_DATA", 0);
	
	private String domainName;
	private int domainId;
	
	private ClimateDomainEnum(String domainName, int domainId) {
        this.domainName = domainName;
        this.domainId = domainId;
    }

	@Override
	public String toString() {
		return getDomainName();
	}

	public int getDomainId() {
		return domainId;
	}

	public String getDomainName() {
		return domainName;
	}

}
