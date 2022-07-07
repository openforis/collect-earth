package org.openforis.collect.earth.ipcc.model;

public abstract class LandUseSubdivision<F> {

	protected LandUseCategory category;
	protected String code;
	protected String name;
	
	public LandUseSubdivision(LandUseCategory category, String code, String name) {
		super();
		this.category = category;
		this.code = code;
		this.name = name;
	}
	
	public abstract F getType();
	public abstract void setType(F type);
	
	public LandUseCategory getCategory() {
		return category;
	}
	public String getCode() {
		return code;
	}
	public String getName() {
		return name;
	}
	public void setCategory(LandUseCategory category) {
		this.category = category;
	}
	public void setCode(String code) {
		this.code = code;
	}
	public void setName(String name) {
		this.name = name;
	}
	
}
