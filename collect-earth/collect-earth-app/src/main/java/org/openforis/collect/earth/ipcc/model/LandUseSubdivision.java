package org.openforis.collect.earth.ipcc.model;

import java.util.Objects;
import java.util.UUID;

public abstract class LandUseSubdivision<F> implements Comparable<LandUseSubdivision<?>>{

	protected LandUseCategory category;
	protected String code;
	protected String name;
	protected String guid;
	protected Integer id;
	
	public LandUseSubdivision(LandUseCategory category, String code, String name, Integer id) {
		super();
		this.category = category;
		this.code = code;
		this.name = name;
		this.id = id;
		this.guid = UUID.randomUUID().toString();
	}
	
	public abstract F getManagementType();
	public abstract void setManagementType(F type);
	
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
	public int compareTo(LandUseSubdivision<?> other) {
		if( this.getCategory().equals( other.getCategory() ) ){
			return this.getCode().compareTo( other.getCode() );
		}else {
			return this.getCategory().getCode().compareTo( other.getCategory().getCode() );
		}	
	}
	
	@Override
	public int hashCode() {
		return Objects.hash(category, code, name);
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		LandUseSubdivision<?> other = (LandUseSubdivision<?>) obj;
		return category == other.category && Objects.equals(code, other.code) && Objects.equals(name, other.name);
	}
	
	@Override
	public String toString() {
		return getCategory().getCode() + " / "  + getManagementType() + " / "  + getCode();
	}

	public String getGuid() {
		return guid;
	}

	public Integer getId() {
		return id;
	}

	public void setId(Integer id) {
		this.id = id;
	}
}
