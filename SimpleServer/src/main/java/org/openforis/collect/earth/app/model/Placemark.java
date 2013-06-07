package org.openforis.collect.earth.app.model;

import java.util.Date;

public class Placemark {

	private boolean activelySaved;

	private String crownCover;

	private String crownType;

	private String humanImpactGrade;

	private String[] humanImpactType;

	private Integer humanImpactYear;

	private Integer id;

	private String landUse;

	private Boolean landUseChange;

	private String landUseType;

	private String latitude;

	private String longitude;

	private Date modified;

	private String operator;

	private String placemarkId;

	private Date rsDate;

	private String rsSatellite;

	private String topographyAccesibility;

	private String topographyCoverage;

	private String topographyElements[];

	public String getCrownCover() {
		return this.crownCover;
	}

	public String getCrownType() {
		return this.crownType;
	}

	public String getHumanImpactGrade() {
		return this.humanImpactGrade;
	}

	public String[] getHumanImpactType() {
		return this.humanImpactType;
	}

	public Integer getHumanImpactYear() {
		return this.humanImpactYear;
	}

	public Integer getId() {
		return id;
	}

	public String getLandUse() {
		return this.landUse;
	}

	public Boolean getLandUseChange() {
		return landUseChange;
	}

	public String getLandUseType() {
		return this.landUseType;
	}

	public String getLatitude() {
		return latitude;
	}

	public String getLongitude() {
		return longitude;
	}

	public Date getModified() {
		return modified;
	}

	public String getOperator() {
		return operator;
	}

	public String getPlacemarkId() {
		return placemarkId;
	}

	public Date getRsDate() {
		return this.rsDate;
	}

	public String getRsSatellite() {
		return this.rsSatellite;
	}

	public String getTopographyAccesibility() {
		return this.topographyAccesibility;
	}

	public String getTopographyCoverage() {
		return this.topographyCoverage;
	}

	public String[] getTopographyElements() {
		return this.topographyElements;
	}

	public Boolean isAcivelySaved() {
		return this.activelySaved;
	}

	public boolean isActivelySaved() {
		return activelySaved;
	}

	public Boolean isLandUseChange() {
		return this.landUseChange;
	}

	public void setActivelySaved(boolean activelySaved) {
		this.activelySaved = activelySaved;
	}

	public void setCrownCover(String crownCover) {
		this.crownCover = crownCover;
	}

	public void setCrownType(String crownType) {
		this.crownType = crownType;
	}

	public void setHumanImpactGrade(String humanImpactGrade) {
		this.humanImpactGrade = humanImpactGrade;
	}

	public void setHumanImpactType(String[] humanImpactType) {
		this.humanImpactType = humanImpactType;
	}

	public void setHumanImpactYear(Integer humanImpactYear) {
		this.humanImpactYear = humanImpactYear;
	}

	public void setId(Integer id) {
		this.id = id;
	}

	public void setLandUse(String landUse) {
		this.landUse = landUse;
	}

	public void setLandUseChange(Boolean landUseChange) {
		this.landUseChange = landUseChange;
	}

	public void setLandUseType(String landUseType) {
		this.landUseType = landUseType;
	}

	public void setLatitude(String latitude) {
		this.latitude = latitude;
	}

	public void setLongitude(String longitude) {
		this.longitude = longitude;
	}

	public void setModified(Date modified) {
		this.modified = modified;
	}

	public void setOperator(String operator) {
		this.operator = operator;
	}

	public void setPlacemarkId(String placemarkId) {
		this.placemarkId = placemarkId;
	}

	public void setRsDate(Date rsDate) {
		this.rsDate = rsDate;
	}

	public void setRsSatellite(String rsSatellite) {
		this.rsSatellite = rsSatellite;
	}

	public void setTopographyAccesibility(String topographyAccesibility) {
		this.topographyAccesibility = topographyAccesibility;
	}

	public void setTopographyCoverage(String topographyCoverage) {
		this.topographyCoverage = topographyCoverage;
	}

	public void setTopographyElements(String[] topographyElements) {
		this.topographyElements = topographyElements;
	}
}
