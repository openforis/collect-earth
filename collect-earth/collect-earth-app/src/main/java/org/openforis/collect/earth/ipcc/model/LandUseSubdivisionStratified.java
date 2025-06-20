package org.openforis.collect.earth.ipcc.model;

import java.util.Objects;
import java.util.UUID;

public class LandUseSubdivisionStratified<E> {

	LandUseCategoryEnum landUseCategory;
	AbstractLandUseSubdivision<E> landUseSubdivision;
	ClimateStratumObject climate;
	EcozoneStratumObject ecozone;
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
	
	public LandUseSubdivisionStratified(LandUseCategoryEnum landUseCategory, AbstractLandUseSubdivision<E> landUseSubdivision,
			ClimateStratumObject climate, SoilStratumObject soil, EcozoneStratumObject ecozone, Integer id) {
		super();
		this.landUseCategory = landUseCategory;
		this.landUseSubdivision = landUseSubdivision;
		this.climate = climate;
		this.soil = soil;
		this.id = id;
		this.ecozone = ecozone;
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

	public EcozoneStratumObject getEcozone() {
		return ecozone;
	}

	public void setEcozone(EcozoneStratumObject ecozone) {
		this.ecozone = ecozone;
	}

	@Override
	public int hashCode() {
		return Objects.hash(climate, ecozone, id, landUseCategory, landUseSubdivision, soil);
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		LandUseSubdivisionStratified<?> other = (LandUseSubdivisionStratified<?>) obj;
		// && Objects.equals(id, other.id) removed !!
		return Objects.equals(climate, other.climate) && Objects.equals(ecozone, other.ecozone)
				 && landUseCategory == other.landUseCategory
				&& Objects.equals(landUseSubdivision, other.landUseSubdivision) && Objects.equals(soil, other.soil);
	}

	@Override
	public String toString() {
	    return String.format("LandUseSubdivisionStratified [landUseCategory=%s, landUseSubdivision=%s, climate=%s, ecozone=%s, soil=%s, id=%d, guid=%s]",
	            landUseCategory.getCode(), landUseSubdivision.getCode(), climate.getLabel(), 
	            ecozone != null ? ecozone.getLabel() : "null", soil.getLabel(), id, guid);
	}
	
	
}
