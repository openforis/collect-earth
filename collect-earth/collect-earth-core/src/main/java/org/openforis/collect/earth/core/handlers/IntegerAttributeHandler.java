package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.model.IntegerValue;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class IntegerAttributeHandler extends AbstractAttributeHandler<IntegerValue> {

	private static final String PREFIX = "integer_";

	public IntegerAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getParameterValue(IntegerValue value) {
		return value == null || value.getValue() == null ? null : value.getValue().toString();
	}

	@Override
	public IntegerValue createValue(String parameterValue) {
		Integer value =null;
		
		try {
			value = Integer.parseInt(parameterValue);
		} catch (Exception e) {
			try {
				Float isItAFloatingNumber = Float.parseFloat( parameterValue );
				value = isItAFloatingNumber.intValue();
			} catch (NumberFormatException e1) {
				throw new NumberFormatException( "Parameter value '" +parameterValue +"' is neither an Integer or a Real number");
			}
		}
		
		return new IntegerValue(value, null);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof NumberAttributeDefinition && ((NumberAttributeDefinition) def).getType() == Type.INTEGER;
	}

}
