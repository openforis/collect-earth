package org.openforis.collect.earth.ipcc.model;

public class LandUseSubdivisionStratified<E> {

	LandUseCategory landUseCategory;
	LandUseSubdivision<E> landUseSubdivision;
	StratumObject climate;
	StratumObject soil;
		
	public LandUseSubdivisionStratified(LandUseCategory landUseCategory, LandUseSubdivision<E> landUseSubdivision,
			StratumObject climate, StratumObject soil) {
		super();
		this.landUseCategory = landUseCategory;
		this.landUseSubdivision = landUseSubdivision;
		this.climate = climate;
		this.soil = soil;
	}
	
	public LandUseCategory getLandUseCategory() {
		return landUseCategory;
	}
	public LandUseSubdivision<E> getLandUseSubdivision() {
		return landUseSubdivision;
	}
	public StratumObject getClimate() {
		return climate;
	}
	public StratumObject getSoil() {
		return soil;
	}
	public void setLandUseCategory(LandUseCategory landUseCategory) {
		this.landUseCategory = landUseCategory;
	}
	public void setLandUseSubdivision(LandUseSubdivision<E> landUseSubdivision) {
		this.landUseSubdivision = landUseSubdivision;
	}
	public void setClimate(StratumObject climate) {
		this.climate = climate;
	}
	public void setSoil(StratumObject soil) {
		this.soil = soil;
	}
	
	
}
