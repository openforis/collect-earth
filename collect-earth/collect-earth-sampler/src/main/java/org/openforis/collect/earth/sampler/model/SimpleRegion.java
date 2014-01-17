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

}
