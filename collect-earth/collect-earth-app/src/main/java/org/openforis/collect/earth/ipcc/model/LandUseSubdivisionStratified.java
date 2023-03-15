package org.openforis.collect.earth.ipcc.model;

import java.util.UUID;

public class LandUseSubdivisionStratified<E> {

	LandUseCategoryEnum landUseCategory;
	AbstractLandUseSubdivision<E> landUseSubdivision;
	ClimateStratumObject climate;
	SoilStratumObject soil;
	Integer id;
	String guid;
		
	public LandUseSubdivisionStratified(LandUseCategoryEnum landUseCategory, AbstractLandUseSubdivision<E> landUseSubdivision,
			ClimateStratumObject climate, SoilStratumObject soil, Integer id) {
		super();
		this.landUseCategory = landUseCategory;
		this.landUseSubdivision = landUseSubdivision;
		this.climate = climate;
		this.soil = soil;
		this.id = id;
		this.guid = UUID.randomUUID().toString();
	}
	
	public LandUseCategoryEnum getLandUseCategory() {
		return landUseCategory;
	}
	public AbstractLandUseSubdivision<E> getLandUseSubdivision() {
		return landUseSubdivision;
	}
	public ClimateStratumObject getClimate() {
		return climate;
	}
	public SoilStratumObject getSoil() {
		return soil;
	}
	public void setLandUseCategory(LandUseCategoryEnum landUseCategory) {
		this.landUseCategory = landUseCategory;
	}
	public void setLandUseSubdivision(AbstractLandUseSubdivision<E> landUseSubdivision) {
		this.landUseSubdivision = landUseSubdivision;
	}
	public void setClimate(ClimateStratumObject climate) {
		this.climate = climate;
	}
	public void setSoil(SoilStratumObject soil) {
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
