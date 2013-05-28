package org.openforis.eye.service;

import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.BooleanAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Value;

public class BooleanAttributeHandler extends AbstractAttributeHandler {

	private static final String PREFIX = "boolean_";

	public BooleanAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		// Values true / false
		return ((BooleanAttribute) entity.get(removePrefix(parameterName), index)).getValue().getValue().toString();
	}


	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), Boolean.parseBoolean(parameterValue));
	}


	@Override
	public boolean isAttributeParseable(Attribute value) {
		return value instanceof BooleanAttribute;
	}

	@Override
	public Value getAttributeValue(String parameterValue) {
		// TODO Auto-generated method stub
		return null;
	}
}
