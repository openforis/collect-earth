package org.openforis.eye.service;

import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Date;
import org.openforis.idm.model.DateAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;

public class DateAttributeHandler extends AbstractAttributeHandler {

	private static final String PREFIX = "date_";

	public DateAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity) {
		return ((DateAttribute) entity.get(removePrefix(parameterName), 0)).getValue().toXmlDate();
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		String[] coordinatesCSV = parameterValue.split("-");
		EntityBuilder.addValue(entity, removePrefix(parameterName),
				new Date(Integer.parseInt(coordinatesCSV[0]), Integer.parseInt(coordinatesCSV[1]), Integer
						.parseInt(coordinatesCSV[2])));
	}

	@Override
	public boolean isAttributeParseable(Attribute value) {
		return value instanceof DateAttribute;
	}
}
