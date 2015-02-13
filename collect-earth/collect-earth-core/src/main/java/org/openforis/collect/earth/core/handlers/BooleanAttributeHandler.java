package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.BooleanAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.BooleanValue;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class BooleanAttributeHandler extends AbstractAttributeHandler<BooleanValue> {

	private static final String PREFIX = "boolean_";

	public BooleanAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getParameterValue(BooleanValue value) {
		return value == null ? null: value.toString();
	}
	
	@Override
	public BooleanValue createValue(String parameterValue) {
		return new BooleanValue(parameterValue.equals("1") || parameterValue.equals("true"));
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof BooleanAttributeDefinition;
	}
}
