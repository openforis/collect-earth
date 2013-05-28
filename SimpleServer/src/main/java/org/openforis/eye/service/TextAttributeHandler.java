package org.openforis.eye.service;

import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.TextValue;
import org.openforis.idm.model.Value;

public class TextAttributeHandler extends AbstractAttributeHandler {

	private static final String PREFIX = "text_";

	public TextAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		return ((TextAttribute) entity.get(removePrefix(parameterName), index)).getValue().getValue();
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), parameterValue);
	}

	@Override
	public boolean isAttributeParseable(Attribute value) {
		return value instanceof TextAttribute;
	}

	@Override
	public Value getAttributeValue(String parameterValue) {
		return new TextValue(parameterValue);
	}

}
