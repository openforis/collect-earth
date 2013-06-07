package org.openforis.collect.earth.sampler.model;

public class SimpleRegion {

	protected String east;
	protected String north;
	protected String south;
	protected String west;

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

}
