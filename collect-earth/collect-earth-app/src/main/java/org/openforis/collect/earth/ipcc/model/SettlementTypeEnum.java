package org.openforis.collect.earth.ipcc.model;

public enum SettlementTypeEnum {

	TREED("Treed" ,1),OTHER("Other", 2);
	
	private final String name;
	private final Integer id;
	
	private SettlementTypeEnum(String name, Integer id) {
        this.name = name;
        this.id = id;
    }

	public String getName() {
		return name;
	}

	@Override
	public String toString() {
		return getName();
	}

	public Integer getId() {
		return id;
	}
	
}
