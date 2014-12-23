package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.RealAttribute;
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
		String cleanName = removePrefix(parameterName);
		Double value = ((RealAttribute) entity.get(cleanName
				, index)).getValue().getValue();
		
		return value==null?null:value.toString();
	}

	@Override
	public RealValue getAttributeValue(String parameterValue) {
		return new RealValue(Double.parseDouble(parameterValue), null);
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof RealAttribute;
	}

}
