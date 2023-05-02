package org.openforis.collect.earth.ipcc.model;

public class CountryCode {

	private String code;
	private String name;

	public CountryCode( String code, String name ) {
		this.code = code;
		this.name = name;
	}

	public String getCode() {
		return code;
	}

	public String getName() {
		return name;
	}
	
	@Override
	public String toString() {
		return getName();
	}
}
