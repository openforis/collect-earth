package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.TextAttributeDefinition;
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
	public String getParameterValue(TextValue value) {
		return value == null ? null : value.getValue();
	}
	
	@Override
	public TextValue createValue(String parameterValue) {
		return new TextValue(parameterValue);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof TextAttributeDefinition;
	}

}
