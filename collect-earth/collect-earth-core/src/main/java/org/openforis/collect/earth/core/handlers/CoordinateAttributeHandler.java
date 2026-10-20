package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.CoordinateAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Coordinate;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class CoordinateAttributeHandler extends AbstractAttributeHandler<Coordinate> {

	private static final String GOOGLE_EARTH_SRS = "EPSG:4326";
	private static final String PREFIX = "coord_";

	public CoordinateAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getParameterValue(Coordinate value) {
		if (value == null) {
			return null;
		}
		StringBuilder sb = new StringBuilder();
		Double longitude = value.getX();
		Double latitude = value.getY();
		
		sb.append(latitude);
		sb.append(",");
		sb.append(longitude);
		
		return sb.toString();
	}
	
	/**
	 * Expects the coordinate as a String "latitude,longitude" 
	 * @param parameterValue the latitude and longitude as "latitude,longitude"
	 * @return Coordinate returns the coordinate generated
	 */
	@Override
	public Coordinate createValue(String parameterValue) {
		String[] coordinatesCSV = parameterValue.split(",");
		// A value with no comma used to throw here, reading coordinatesCSV[1]
		if (coordinatesCSV.length < 2) {
			throw new IllegalArgumentException("Expected \"latitude,longitude[,srs]\" but received : " + parameterValue);
		}

		String srs = GOOGLE_EARTH_SRS;
		if (coordinatesCSV.length > 2) {
			srs = coordinatesCSV[2].trim();
		}

		// Google Earth sends the unsubstituted placeholder, or "null", when it has no value for the coordinate
		String latitude = defaultToZero(coordinatesCSV[0], "$[latitude]");
		String longitude = defaultToZero(coordinatesCSV[1], "$[longitude]");

		// Coordinate takes ( x, y ), which is ( longitude, latitude )
		return new Coordinate(Double.parseDouble(longitude), Double.parseDouble(latitude), srs);
	}

	private static String defaultToZero(String coordinate, String placeholder) {
		String value = coordinate.trim();
		// The longitude used to be tested against the latitude variable here, so it was never defaulted
		return value.isEmpty() || value.equals(placeholder) || value.equalsIgnoreCase("null") ? "0" : value;
	}


	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof CoordinateAttributeDefinition;
	}
}
