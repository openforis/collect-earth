package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.BooleanAttribute;
import org.openforis.idm.model.BooleanValue;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.Value;

public class BooleanAttributeHandler extends AbstractAttributeHandler<Value> {

	private static final String PREFIX = "boolean_";

	public BooleanAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), Boolean.parseBoolean(parameterValue));
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		// Values true / false
		return ((BooleanAttribute) entity.get(removePrefix(parameterName), index)).getValue().getValue().toString();
	}

	@Override
	public Value getAttributeValue(String parameterValue) {
		return new BooleanValue(parameterValue);
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof BooleanAttribute;
	}
}
