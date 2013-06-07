package org.openforis.collect.earth.app.service;

import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Date;
import org.openforis.idm.model.DateAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Value;

public class DateAttributeHandler extends AbstractAttributeHandler {

	private static final String PREFIX = "date_";

	public DateAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		return ((DateAttribute) entity.get(removePrefix(parameterName), index)).getValue().toXmlDate();
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), getDate(parameterValue));
	}

	private Date getDate(String parameterValue) {
		String[] coordinatesCSV = parameterValue.split("-");
		Date date = new Date(Integer.parseInt(coordinatesCSV[0]), Integer.parseInt(coordinatesCSV[1]),
				Integer.parseInt(coordinatesCSV[2]));
		return date;
	}

	@Override
	public boolean isAttributeParseable(Attribute value) {
		return value instanceof DateAttribute;
	}

	@Override
	public Value getAttributeValue(String parameterValue) {
		return getDate(parameterValue);
	}
}
