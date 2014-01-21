package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.IntegerAttribute;
import org.openforis.idm.model.IntegerValue;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class IntegerAttributeHandler extends AbstractAttributeHandler<Value> {

	private static final String PREFIX = "integer_";
	private Logger logger = LoggerFactory.getLogger(IntegerAttributeHandler.class);

	public IntegerAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {

		try {
			EntityBuilder.addValue(entity, removePrefix(parameterName), Integer.parseInt(parameterValue));
		} catch (NumberFormatException e) {
			logger.error("The paramater " + parameterName + " was expecting an integer value but got this : " + parameterValue);
		}
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		return ((IntegerAttribute) entity.get(removePrefix(parameterName), index)).getValue().getValue().toString();
	}

	@Override
	public Value getAttributeValue(String parameterValue) {
		return new IntegerValue(Integer.parseInt(parameterValue), null);
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof IntegerAttribute;
	}

}
