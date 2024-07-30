package org.openforis.collect.earth.ipcc.model;

import java.util.Objects;
import java.util.UUID;

import org.jooq.tools.StringUtils;

public abstract class AbstractLandUseSubdivision<F> implements Comparable<AbstractLandUseSubdivision<?>>{

	protected LandUseCategoryEnum category;
	protected String code;
	protected String guid;
	protected Integer id;
	protected String name;
	
	public AbstractLandUseSubdivision(LandUseCategoryEnum category, String code, String name, Integer id) {
		super();
		this.category = category;
		this.code = code;
		this.name = name;
		this.id = id;
		this.guid = UUID.randomUUID().toString();
	}
	
	@Override
	public int compareTo(AbstractLandUseSubdivision<?> other) {
		if( this.getCategory().equals( other.getCategory() ) ){
			return this.getCode().compareTo( other.getCode() );
		}else {
			return this.getCategory().getCode().compareTo( other.getCategory().getCode() );
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
		AbstractLandUseSubdivision<?> other = (AbstractLandUseSubdivision<?>) obj;
		return category == other.category && Objects.equals(code, other.code) && Objects.equals(name, other.name);
	}
	
	public LandUseCategoryEnum getCategory() {
		return category;
	}
	public String getCode() {
		return code;
	}
	public String getGuid() {
		return guid;
	}
	public Integer getId() {
		return id;
	}
	public abstract F getManagementType();
	public String getName() {
		return name;
	}
	
	@Override
	public int hashCode() {
		return Objects.hash(category, code, name);
	}
	
	public void setCategory(LandUseCategoryEnum category) {
		this.category = category;
	}

	public void setCode(String code) {
		this.code = code;
	}
	
	public void setId(Integer id) {
		this.id = id;
	}

	public abstract void setManagementType(F type);

	public void setName(String name) {
		this.name = name;
	}

	@Override
	public String toString() {
		// sometimes the name might be empty if it was not specified in the right language in the survey (i.e. the label is present for Italian but not English )
		if( StringUtils.isEmpty( getName() ) ) {			
			return getCategory().getCode() + " / "  + getManagementType() + " / "  + getCode();
		}
		return getCategory().getCode() + " / "  + getManagementType() + " / "  + getName();
	}
}
