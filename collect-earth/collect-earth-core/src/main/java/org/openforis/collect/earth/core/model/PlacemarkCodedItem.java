package org.openforis.collect.earth.core.model;

/**
 * 
 * @author S. Ricci
 *
 */
public class PlacemarkCodedItem {
	
	private String code;
	private String label;
	
	public PlacemarkCodedItem(String code, String label) {
		super();
		this.code = code;
		this.label = label;
	}
	
	public String getCode() {
		return code;
	}
	
	public String getLabel() {
		return label;
	}
	
}