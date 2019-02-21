package org.openforis.collect.earth.sampler.model;

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

import org.locationtech.jts.geom.Coordinate;

/**
 * Sstores the coordinates as latitude and longitude strings.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class SimpleCoordinate {


	private String latitude;
	private String longitude;
	
	
	private static final DecimalFormat DF;
	
	static {
		DecimalFormatSymbols symbols = new DecimalFormatSymbols( Locale.getDefault() );
		symbols.setDecimalSeparator('.');
		DF = new DecimalFormat("#.######", symbols);
	}


	public SimpleCoordinate(Coordinate coord) {
		super();
		this.longitude = DF.format( coord.x );
		this.latitude = DF.format( coord.y );
	}

	public SimpleCoordinate(double[] coordLatLong) {
		super();
		this.longitude = DF.format( coordLatLong[1] );
		this.latitude = DF.format( coordLatLong[0] );
	}
	
	public SimpleCoordinate(Double latitude, Double longitude) {
		super();
		this.longitude = DF.format( longitude );
		this.latitude = DF.format( latitude );
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

	public double[] getCoordinates() {
		return new double[]{ Double.parseDouble(getLatitude()), Double.parseDouble( getLongitude() ) };
	}

	public void setLatitude(String latitude) {
		this.latitude = latitude;
	}

	public void setLongitude(String longitude) {
		this.longitude = longitude;
	}
	
	@Override
	public String toString() {
		return latitude + "," + longitude;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result
				+ ((latitude == null) ? 0 : latitude.hashCode());
		result = prime * result
				+ ((longitude == null) ? 0 : longitude.hashCode());
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
		SimpleCoordinate other = (SimpleCoordinate) obj;
		if (latitude == null) {
			if (other.latitude != null)
				return false;
		} else if (!latitude.equals(other.latitude))
			return false;
		if (longitude == null) {
			if (other.longitude != null)
				return false;
		} else if (!longitude.equals(other.longitude))
			return false;
		return true;
	}
}