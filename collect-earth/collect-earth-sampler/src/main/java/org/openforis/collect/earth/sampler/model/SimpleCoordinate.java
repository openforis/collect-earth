package org.openforis.collect.earth.sampler.model;

import com.vividsolutions.jts.geom.Coordinate;

/**
 * Sstores the coordinates as latitude and longitude strings.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class SimpleCoordinate {
	private String latitude;
	private String longitude;

	public SimpleCoordinate(Coordinate coord) {
		super();
		this.longitude = coord.x + "";
		this.latitude = coord.y + "";
	}

	public SimpleCoordinate(double[] coordLatLong) {
		super();
		this.longitude = coordLatLong[0] + "";
		this.latitude = coordLatLong[1] + "";
	}

	public SimpleCoordinate( String latitude, String longitude) {
		super();
		this.longitude = longitude;
		this.latitude = latitude;
	}

	public String getLatitude() {
		return latitude;
	}

	public String getLongitude() {
		return longitude;
	}

	public void setLatitude(String latitude) {
		this.latitude = latitude;
	}

	public void setLongitude(String longitude) {
		this.longitude = longitude;
	}
}