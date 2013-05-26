package org.openforis.eye.service;

import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Coordinate;
import org.openforis.idm.model.CoordinateAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;

public class CoordinateAttributeHandler extends AbstractAttributeHandler {

	private static final String PREFIX = "coord_";

	public CoordinateAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity) {
		return ((CoordinateAttribute) entity.get(removePrefix(parameterName), 0)).getValue().toString();
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		String[] coordinatesCSV = parameterValue.split(",");
		EntityBuilder.addValue(entity, removePrefix(parameterName),
				new Coordinate(Double.parseDouble(coordinatesCSV[0]), Double.parseDouble(coordinatesCSV[1]), coordinatesCSV[2]));
	}


	@Override
	public boolean isAttributeParseable(Attribute value) {
		return value instanceof CoordinateAttribute;
	}
}
