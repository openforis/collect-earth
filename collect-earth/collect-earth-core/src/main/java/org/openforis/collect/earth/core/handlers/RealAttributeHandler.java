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
		try {
			return new RealValue(Double.parseDouble(parameterValue.replace(',', '.')), null);
		}catch(NumberFormatException e) {
			// Thrown, as the integer handler does, so that the value is kept and the interpreter is told on the field. Returning
			// null here erased the value that was stored, without a word, whenever a number was mistyped
			throw new NumberFormatException( "Parameter value '" + parameterValue + "' is not a number");
		}
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof NumberAttributeDefinition && ((NumberAttributeDefinition) def).getType() == Type.REAL;
	}

}
