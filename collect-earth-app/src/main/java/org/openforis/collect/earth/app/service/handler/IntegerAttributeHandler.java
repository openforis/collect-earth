package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.IntegerAttribute;
import org.openforis.idm.model.IntegerValue;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.Value;

public class IntegerAttributeHandler extends AbstractAttributeHandler< Value> {

	private static final String PREFIX = "integer_";

	public IntegerAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		return ((IntegerAttribute) entity.get(removePrefix(parameterName), index)).getValue().getValue().toString();
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), Integer.parseInt(parameterValue));
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof IntegerAttribute;
	}

	@Override
	public Value getAttributeValue(String parameterValue) {
		return new IntegerValue(Integer.parseInt(parameterValue), null);
	}

}
