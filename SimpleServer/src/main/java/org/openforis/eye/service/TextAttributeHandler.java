package org.openforis.eye.service;

import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.TextAttribute;

public class TextAttributeHandler extends AbstractAttributeHandler {

	private static final String PREFIX = "text_";

	public TextAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity) {
		return ((TextAttribute) entity.get(removePrefix(parameterName), 0)).getValue().getValue();
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), parameterValue);
	}

	@Override
	public boolean isAttributeParseable(Attribute value) {
		return value instanceof TextAttribute;
	}

}
