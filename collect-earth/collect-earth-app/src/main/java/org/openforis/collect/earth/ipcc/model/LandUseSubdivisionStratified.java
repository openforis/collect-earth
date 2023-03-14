package org.openforis.collect.earth.ipcc.model;

import java.util.UUID;

public class LandUseSubdivisionStratified<E> {

	LandUseCategory landUseCategory;
	LandUseSubdivision<E> landUseSubdivision;
	StratumObject climate;
	StratumObject soil;
	Integer id;
	String guid;
		
	public LandUseSubdivisionStratified(LandUseCategory landUseCategory, LandUseSubdivision<E> landUseSubdivision,
			StratumObject climate, StratumObject soil, Integer id) {
		super();
		this.landUseCategory = landUseCategory;
		this.landUseSubdivision = landUseSubdivision;
		this.climate = climate;
		this.soil = soil;
		this.id = id;
		this.guid = UUID.randomUUID().toString();
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

	public Integer getId() {
		return id;
	}

	public void setId(Integer id) {
		this.id = id;
	}

	public String getGuid() {
		return guid;
	}

	public void setGuid(String guid) {
		this.guid = guid;
	}
	
	
}
