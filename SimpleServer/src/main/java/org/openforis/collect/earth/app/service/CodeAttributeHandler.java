package org.openforis.collect.earth.app.service;

import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Code;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Value;

public class CodeAttributeHandler extends AbstractAttributeHandler {

	private static final String PREFIX = "code_";

	public CodeAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		return ((CodeAttribute) entity.get(removePrefix(parameterName), index)).getValue().getCode();
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), new Code(parameterValue));
	}


	@Override
	public boolean isAttributeParseable(Attribute value) {
		return value instanceof CodeAttribute;
	}

	@Override
	public Value getAttributeValue(String parameterValue) {
		return new Code(parameterValue);
	}

}
