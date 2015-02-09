package org.openforis.collect.earth.core.handlers;

import org.openforis.collect.model.NodeChangeSet;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.TextAttributeDefinition;
import org.openforis.idm.model.Entity;
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
	public NodeChangeSet addToEntity(String parameterName, String parameterValue, Entity entity) {
		NodeChangeSet changeSet = recordUpdater.addAttribute(entity, removePrefix(parameterName), getAttributeValue(parameterValue));
		return changeSet;
//		EntityBuilder.addValue(entity, removePrefix(parameterName), parameterValue);
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
	public boolean isParseable(NodeDefinition def) {
		return def instanceof TextAttributeDefinition;
	}

}
