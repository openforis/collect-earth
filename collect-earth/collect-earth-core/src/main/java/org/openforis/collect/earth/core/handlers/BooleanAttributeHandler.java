package org.openforis.collect.earth.core.handlers;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import org.openforis.idm.metamodel.BooleanAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.BooleanValue;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class BooleanAttributeHandler extends AbstractAttributeHandler<BooleanValue> {

	private static final Set<String> BOOLEAN_VALUES = Collections.unmodifiableSet(new HashSet<String>(Arrays.asList("1", "true", "on")));
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
		return new BooleanValue(BOOLEAN_VALUES.contains(parameterValue));
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof BooleanAttributeDefinition;
	}
}
