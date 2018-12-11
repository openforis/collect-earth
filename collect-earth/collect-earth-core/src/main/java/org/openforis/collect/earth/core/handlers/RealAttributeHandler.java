package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.model.RealValue;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class RealAttributeHandler extends AbstractAttributeHandler<RealValue> {

	private static final String PREFIX = "real_";

	public RealAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getParameterValue(RealValue value) {
		return value == null || value.getValue() == null ? null : value.getValue().toString();
	}

	@Override
	public RealValue createValue(String parameterValue) {
		return new RealValue(Double.parseDouble(parameterValue.replace(',', '.')), null);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof NumberAttributeDefinition && ((NumberAttributeDefinition) def).getType() == Type.REAL;
	}

}
