package org.openforis.collect.earth.ipcc.model;

public class LandUseSubdivisionStratified {

	String landUseSubdivision;
	Integer climateId;
	Integer soilId;
	
	public LandUseSubdivisionStratified(String landUseSubdivision, Integer climateId, Integer soilId) {
		super();
		this.landUseSubdivision = landUseSubdivision;
		this.climateId = climateId;
		this.soilId = soilId;
	}

	public String getLandUseSubdivision() {
		return landUseSubdivision;
	}

	public Integer getClimateId() {
		return climateId;
	}

	public Integer getSoilId() {
		return soilId;
	}

	public void setLandUseSubdivision(String landUseSubdivision) {
		this.landUseSubdivision = landUseSubdivision;
	}

	public void setClimateId(Integer climateId) {
		this.climateId = climateId;
	}

	public void setSoilId(Integer soilId) {
		this.soilId = soilId;
	}
		
		
}
