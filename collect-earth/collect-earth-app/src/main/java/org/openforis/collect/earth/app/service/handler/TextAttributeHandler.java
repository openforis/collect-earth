package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.TextValue;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class TextAttributeHandler extends AbstractAttributeHandler<TextValue> {

	private static final String PREFIX = "text_";

	public TextAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), parameterValue);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		String cleanName = removePrefix(parameterName);
		
		return ((TextAttribute) entity.get(cleanName, index)).getValue().getValue();
	}

	@Override
	public TextValue getAttributeValue(String parameterValue) {
		return new TextValue(parameterValue);
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof TextAttribute;
	}

}
