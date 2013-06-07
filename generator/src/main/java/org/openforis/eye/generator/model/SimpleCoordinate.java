package org.openforis.eye.generator.model;

import com.vividsolutions.jts.geom.Coordinate;

public class SimpleCoordinate {
	public String latitude;
	public String longitude;

	public SimpleCoordinate(Coordinate coord) {
		super();
		this.longitude = coord.x + "";
		this.latitude = coord.y + "";
	}

	public SimpleCoordinate(double[] coord) {
		super();
		this.longitude = coord[0] + "";
		this.latitude = coord[1] + "";
	}

	public SimpleCoordinate(String longitude, String latitude) {
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