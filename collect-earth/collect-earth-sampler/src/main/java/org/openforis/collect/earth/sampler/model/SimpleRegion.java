package org.openforis.collect.earth.sampler.model;

/**
 * Define a square region using the north-west and south-east points.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class SimpleRegion {

	private String east;
	private String north;
	private String south;
	private String west;

	public SimpleRegion(String north, String west, String south, String east) {
		super();
		this.east = east;
		this.north = north;
		this.south = south;
		this.west = west;
	}

	public String getEast() {
		return east;
	}

	public String getNorth() {
		return north;
	}

	public String getSouth() {
		return south;
	}

	public String getWest() {
		return west;
	}

	public void setEast(String east) {
		this.east = east;
	}

	public void setNorth(String north) {
		this.north = north;
	}

	public void setSouth(String south) {
		this.south = south;
	}

	public void setWest(String west) {
		this.west = west;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + ((east == null) ? 0 : east.hashCode());
		result = prime * result + ((north == null) ? 0 : north.hashCode());
		result = prime * result + ((south == null) ? 0 : south.hashCode());
		result = prime * result + ((west == null) ? 0 : west.hashCode());
		return result;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		SimpleRegion other = (SimpleRegion) obj;
		if (east == null) {
			if (other.east != null)
				return false;
		} else if (!east.equals(other.east))
			return false;
		if (north == null) {
			if (other.north != null)
				return false;
		} else if (!north.equals(other.north))
			return false;
		if (south == null) {
			if (other.south != null)
				return false;
		} else if (!south.equals(other.south))
			return false;
		if (west == null) {
			if (other.west != null)
				return false;
		} else if (!west.equals(other.west))
			return false;
		return true;
	}

}
