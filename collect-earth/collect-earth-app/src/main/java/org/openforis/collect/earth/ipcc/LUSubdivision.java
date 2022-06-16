package org.openforis.collect.earth.ipcc;

import java.util.Objects;

public class LUSubdivision implements Comparable<LUSubdivision> {

	private String category;
	private String subdivision;

	public LUSubdivision(String category, String subdivision) {
		super();
		this.category = category;
		this.subdivision = subdivision;
	}

	@Override
	public int compareTo(LUSubdivision other) {
		if( this.getCategory().equals( other.getCategory() ) ){
			return this.getSubdivision().compareTo( other.getSubdivision() );
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
		LUSubdivision other = (LUSubdivision) obj;
		return Objects.equals(category, other.category) && Objects.equals(subdivision, other.subdivision);
	}
	public String getCategory() {
		return category;
	}
	public String getSubdivision() {
		return subdivision;
	}
	@Override
	public int hashCode() {
		return Objects.hash(category, subdivision);
	}

	public void setCategory(String category) {
		this.category = category;
	}

	public void setSubdivision(String subdivision) {
		this.subdivision = subdivision;
	}

	@Override
	public String toString() {
		return category + " / " + subdivision;
	}


}
