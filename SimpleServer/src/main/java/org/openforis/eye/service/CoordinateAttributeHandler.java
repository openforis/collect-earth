package org.openforis.eye.service;

import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Coordinate;
import org.openforis.idm.model.CoordinateAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Value;

public class CoordinateAttributeHandler extends AbstractAttributeHandler {

	private static final String PREFIX = "coord_";

	public CoordinateAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		return ((CoordinateAttribute) entity.get(removePrefix(parameterName), index)).getValue().getX() + ","
				+ ((CoordinateAttribute) entity.get(removePrefix(parameterName), index)).getValue().getY();
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		Coordinate coord = extractCoordinate(parameterValue);

		EntityBuilder.addValue(entity, removePrefix(parameterName), coord);
	}

	private Coordinate extractCoordinate(String parameterValue) {
		String[] coordinatesCSV = parameterValue.split(",");
		String srs = "";
		if (coordinatesCSV.length > 2) {
			srs = coordinatesCSV[2];
		}
		// REMOVE THIS!!
		// -----------------------
		if (coordinatesCSV[0].equals("$[longitude]")) {
			coordinatesCSV[0] = "0";
		}
		if (coordinatesCSV[1].equals("$[latitude]")) {
			coordinatesCSV[1] = "0";
		}
		// -----------------------

		Coordinate coord = new Coordinate(Double.parseDouble(coordinatesCSV[0]), Double.parseDouble(coordinatesCSV[1]), srs);
		return coord;
	}


	@Override
	public boolean isAttributeParseable(Attribute value) {
		return value instanceof CoordinateAttribute;
	}

	@Override
	public Value getAttributeValue(String parameterValue) {
		return extractCoordinate(parameterValue);
	}
}
