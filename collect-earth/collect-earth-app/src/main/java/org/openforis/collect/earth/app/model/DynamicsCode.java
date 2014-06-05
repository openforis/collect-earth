package org.openforis.collect.earth.app.model;

import org.apache.commons.lang3.StringUtils;

/**
 * Enumeration of the dynamics that Collect Earth can use to classify the plots.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
public enum DynamicsCode {
	FROM_FOREST("Initially Forest", 1), FROM_GRASSLAND("Initially Grassland", 3), FROM_SETTLEMENT("Initially Settlement", 4), FROM_OTHERLAND("Initially Otherland", 5), FROM_WETLAND("Initially Wetland", 6), FROM_CROPLAND("Initially Cropland", 7),  NA("NA", 8);

	private String label;

	private int id;

	private DynamicsCode(String label, int id) {
		this.label = label;
		this.id = id;
	}

	public int getId() {
		return id;
	}

	public String getLabel() {
		return label;
	}

	public void setId(int id) {
		this.id = id;
	}

	@Override
	public String toString() {
		return label;
	}

	public static Integer getDynamicsCode(String landUseSubcategory) {
		if( landUseSubcategory.startsWith("FLto") ){
			return FROM_FOREST.getId();
		}else if( landUseSubcategory.startsWith("CLto") ){
			return FROM_CROPLAND.getId();
		}else if( landUseSubcategory.startsWith("SLto") ){
			return FROM_SETTLEMENT.getId();
		}else if( landUseSubcategory.startsWith("WLto") ){
			return FROM_WETLAND.getId();
		}else if( landUseSubcategory.startsWith("GLto") ){
			return FROM_GRASSLAND.getId();
		}else if( landUseSubcategory.startsWith("OLto") || landUseSubcategory.startsWith("OTto")){
			return FROM_OTHERLAND.getId();
		}else if ( StringUtils.isBlank( landUseSubcategory )) {
			throw new IllegalArgumentException("The land use subcategory " + landUseSubcategory + " is not recognizable.");
		}else{
			return NA.getId();
		}
	}

}
