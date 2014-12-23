package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.BooleanAttribute;
import org.openforis.idm.model.BooleanValue;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Node;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class BooleanAttributeHandler extends AbstractAttributeHandler<BooleanValue> {

	private static final String PREFIX = "boolean_";

	public BooleanAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		if( parameterValue.equals("1")){
			parameterValue = "true";
		}else if( parameterValue.equals("0")){
			parameterValue = "false";
		}
		
		EntityBuilder.addValue(entity, removePrefix(parameterName), Boolean.parseBoolean(parameterValue));
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		String cleanName = removePrefix(parameterName);
		Boolean value = ((BooleanAttribute) entity.get(cleanName, index)).getValue().getValue();
		
		return value==null?null:value.toString();		
	}

	@Override
	public BooleanValue getAttributeValue(String parameterValue) {
		return new BooleanValue(parameterValue);
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof BooleanAttribute;
	}
}
