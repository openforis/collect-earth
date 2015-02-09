package org.openforis.collect.earth.core.handlers;

import org.openforis.collect.model.NodeChangeSet;
import org.openforis.idm.metamodel.CoordinateAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Coordinate;
import org.openforis.idm.model.CoordinateAttribute;
import org.openforis.idm.model.Entity;

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
	public NodeChangeSet addToEntity(String parameterName, String parameterValue, Entity entity) {
		Coordinate coord = extractCoordinate(parameterValue);
//		EntityBuilder.addValue(entity, removePrefix(parameterName), coord);
		
		NodeChangeSet changeSet = recordUpdater.addAttribute(entity, removePrefix(parameterName), coord);
		return changeSet;
	}

	/**
	 * Expects the coordinate as a String "latitude,longitude" 
	 * @param parameterValue
	 * @return
	 */
	private Coordinate extractCoordinate(String parameterValue) {
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

	/*
	 * Returns the  coordinate as a latitude,longitude String
	 *  (non-Javadoc)
	 * @see org.openforis.collect.earth.app.service.handler.AbstractAttributeHandler#getAttributeFromParameter(java.lang.String, org.openforis.idm.model.Entity, int)
	 */
	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		String cleanName = removePrefix(parameterName);
		if( entity.get(cleanName, index) == null){
			return "";
		}
		
		StringBuilder stringBuilder = new StringBuilder();
		Coordinate value = ((CoordinateAttribute) entity.get(cleanName, index)).getValue();
		Double longitude = value.getX();
		Double latitude = value.getY();
		
		stringBuilder.append(latitude);
		stringBuilder.append(",");
		stringBuilder.append(longitude);
		
		return stringBuilder.toString();
	}

	@Override
	public Coordinate getAttributeValue(String parameterValue) {
		return extractCoordinate(parameterValue);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof CoordinateAttributeDefinition;
	}
}
