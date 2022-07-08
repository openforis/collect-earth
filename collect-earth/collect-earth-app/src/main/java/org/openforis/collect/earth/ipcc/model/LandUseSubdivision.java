package org.openforis.collect.earth.ipcc.model;

import java.util.Objects;

public abstract class LandUseSubdivision<F> implements Comparable<LandUseSubdivision<F>>{

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
	
	@Override
	public int compareTo(LandUseSubdivision other) {
		if( this.getCategory().equals( other.getCategory() ) ){
			return this.getCode().compareTo( other.getCode() );
		}else {
			return this.getCategory().compareTo( other.getCategory() );
		}	
	}
	
	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		LandUseSubdivision<F> other = (LandUseSubdivision) obj;
		return Objects.equals(category, other.category) && Objects.equals(code, other.code) && Objects.equals(getType(), other.getType());
	}
}
