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
	 * @param parameterValue
	 * @return
	 */
	@Override
	public Coordinate createValue(String parameterValue) {
		String[] coordinatesCSV = parameterValue.split(",");
		String srs = GOOGLE_EARTH_SRS;
		if (coordinatesCSV.length > 2) {
			srs = coordinatesCSV[2];
		}
		// REMOVE THIS!!
		// -----------------------
		String latitude = coordinatesCSV[0];
		if (latitude.equals("$[latitude]")) {
			latitude = "0";
		}
		String longitude = coordinatesCSV[1];
		if (longitude.equals("$[longitude]")) {
			longitude = "0";
		}
		// -----------------------

		//TODO : VERY IMPORTANT!!!!
		// THE ORDER OF THE COORDINATES IS CHANGED HERE SO THAT THE PNG BUG IS CONSISTENT THROUGHOUT THEIR ASSESSMENT!!
		// CHANGE BACK WHEN THEY ARE FINIHSED!!!!!!
		
		Coordinate coord = new Coordinate(Double.parseDouble(longitude), Double.parseDouble(latitude), srs);
		//Coordinate coord = new Coordinate(Double.parseDouble(coordinatesCSV[0]), Double.parseDouble(coordinatesCSV[1]), srs); PNG BUG IN THIS LINE!!
		return coord;
	}


	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof CoordinateAttributeDefinition;
	}
}
