package org.openforis.collect.earth.ipcc.model;

public enum EcozoneTypeEnum {
	TAr("Tropical rain forest", 2, "wet: ≤ 3 months dry, during winter"),
	TAwa("Tropical moist deciduous forest", 4, "mainly wet: 3-5 months dry, during winter"),
	TAWb("Tropical dry forest", 5, "mainly dry: 5-8 months dry, during winter"),
	TBSh("Tropical shrubland", 6, "semi-arid: evaporation > precipitation"),
	TBWh("Tropical desert", 7, "arid: all months dry"),
	TM("Tropical mountain systems", 8, "altitudes approximately >1000 m, with local variations"),
	SCf("Subtropical humid forest", 9, "humid: no dry season"),
	SCs("Subtropical dry forest", 10, "seasonally dry: winter rains, dry summer"),
	SBSh("Subtropical steppe", 11, "semi-arid: evaporation >precipitation"),
	SBWh("Subtropical desert", 12, "arid: all months dry"),
	SM("Subtropical mountain systems", 13, "altitudes approximately 800 m- 1000 m"),
	TeDo("Temperate oceanic forest", 14, "oceanic climate: coldest month >0°C"),
	TeDc("Temperate continental forest", 17, "continental climate: coldest month <0°C"),
	TeBSk("Temperate steppe", 18, "semi-arid: evaporation > precipitation"),
	TeBWk("Temperate desert", 19, "arid: all months dry"),
	TeM("Temperate mountain systems", 20, "altitudes approximately >800 m"),
	Ba("Boreal coniferous forest", 21, "coniferous dense forest dominant"),
	Bb("Boreal tundra woodland", 22, "woodland and sparse forest dominant"),
	BM("Boreal mountain systems", 23, "altitudes approximately >600 m"), P("Polar", 24, "all months <10°C"),
	NA("User-defined", 25, "Not part of IPCC 2006 default classification"),
	NO_DATA("NO_DATA", 0, "No data available");

	private final String name;
	private int id;
	private String description;

	private EcozoneTypeEnum(String name, int id, String description) {
		this.name = name;
		this.id = id;
		this.description = description;
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

	public String getDescription() {
		return description;
	}

}
