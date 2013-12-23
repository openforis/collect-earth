package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.RealAttribute;
import org.openforis.idm.model.RealValue;
import org.openforis.idm.model.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class RealAttributeHandler extends AbstractAttributeHandler<Value> {

	private static final String PREFIX = "real_";
	private Logger logger = LoggerFactory.getLogger(IntegerAttributeHandler.class);

	public RealAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {

		try {
			EntityBuilder.addValue(entity, removePrefix(parameterName), Double.parseDouble(parameterValue));
		} catch (NumberFormatException e) {
			logger.error("The paramater " + parameterName + " was expecting a real number value but got this : " + parameterValue);
		}
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		return ((RealAttribute) entity.get(removePrefix(parameterName), index)).getValue().getValue().toString();
	}

	@Override
	public Value getAttributeValue(String parameterValue) {
		return new RealValue(Double.parseDouble(parameterValue), null);
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof RealAttribute;
	}

}
