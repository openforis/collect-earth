package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.IntegerAttribute;
import org.openforis.idm.model.IntegerValue;
import org.openforis.idm.model.Node;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class IntegerAttributeHandler extends AbstractAttributeHandler<IntegerValue> {

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
		String cleanName = removePrefix(parameterName);
		Integer value = ((IntegerAttribute) entity.get(cleanName, index)).getValue().getValue();
		return value==null?null:value.toString();
	}

	@Override
	public IntegerValue getAttributeValue(String parameterValue) {
		return new IntegerValue(Integer.parseInt(parameterValue), null);
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof IntegerAttribute;
	}

}
