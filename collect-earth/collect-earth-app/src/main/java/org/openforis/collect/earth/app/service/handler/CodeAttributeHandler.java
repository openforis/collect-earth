package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.model.Code;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Node;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class CodeAttributeHandler extends AbstractAttributeHandler<Code> {

	private static final String PREFIX = "code_";

	public CodeAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public void addToEntity(String parameterName, String parameterValue, Entity entity) {
		EntityBuilder.addValue(entity, removePrefix(parameterName), new Code(parameterValue));
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		String cleanName = removePrefix(parameterName);
	
		return ((CodeAttribute) entity.get(cleanName, index)).getValue().getCode();
	}

	@Override
	public Code getAttributeValue(String parameterValue) {
		return new Code(parameterValue);
	}

	@Override
	public boolean isParseable(Node value) {
		return value instanceof CodeAttribute;
	}

}
