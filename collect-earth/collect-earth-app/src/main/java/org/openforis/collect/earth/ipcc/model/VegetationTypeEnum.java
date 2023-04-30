package org.openforis.collect.earth.ipcc.model;

public enum VegetationTypeEnum {
	/*
	ST("Steppe", 1, 4), 
	TU("Tundra", 2, 4),
	PR("Prairie", 3, 4),
	SA("Semi-Arid", 4, 2.8),
	SUBTROP("Sub-Tropical", 5, 1.6),
	TR("Tropical", 6, 1.6),
	WL("Woodland", 7, 0.5),
	SV("Savannah", 8, 0.5),
	SH("Shrubland", 9, 2.8)
	*/
	WL("Woodland", 24, 0.5),
	SV("Savannah", 25, 0.5),
	SH("Shrubland", 26, 2.8)
	;
	
	private final String name;
	private int id;
	private double ratioBgb;
	
	private VegetationTypeEnum(String name, int id, double ratioBgb) {
        this.name = name;
        this.id = id;
        this.ratioBgb = ratioBgb;
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

	public double getRatioBgb() {
		return ratioBgb;
	}

}
