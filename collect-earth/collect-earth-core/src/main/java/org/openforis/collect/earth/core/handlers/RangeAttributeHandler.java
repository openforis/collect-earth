package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.metamodel.RangeAttributeDefinition;
import org.openforis.idm.model.IntegerValue;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class RangeAttributeHandler extends AbstractAttributeHandler<IntegerValue> {

	private static final String PREFIX = "integer_range_";

	public RangeAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getParameterValue(IntegerValue value) {
		return value == null || value.getValue() == null ? null : value.getValue().toString();
	}

	@Override
	public IntegerValue createValue(String parameterValue) {
		return new IntegerValue(Integer.parseInt(parameterValue), null);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof RangeAttributeDefinition && ((RangeAttributeDefinition) def).getType() == Type.INTEGER;
	}

}