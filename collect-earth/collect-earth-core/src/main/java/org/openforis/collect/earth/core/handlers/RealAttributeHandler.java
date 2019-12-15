package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.model.RealValue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class RealAttributeHandler extends AbstractAttributeHandler<RealValue> {

	private final Logger logger = LoggerFactory.getLogger(RealAttributeHandler.class);
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
		Double value = null;
		try {
			value = Double.parseDouble(parameterValue.replace(',', '.'));
		}catch(NumberFormatException e) {
			logger.warn( "The number format is not correct for : " + parameterValue, e);
		}		
		return value!=null?new RealValue(value, null):null;
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof NumberAttributeDefinition && ((NumberAttributeDefinition) def).getType() == Type.REAL;
	}

}
