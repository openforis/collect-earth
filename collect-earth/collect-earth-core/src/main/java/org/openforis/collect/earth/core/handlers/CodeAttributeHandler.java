package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Code;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class CodeAttributeHandler extends AbstractAttributeHandler<Code> {

	private static final String PREFIX = "code_";

	public CodeAttributeHandler() {
		this(PREFIX);
	}
	
	public CodeAttributeHandler(String prefix) {
		super(prefix);
	}

	@Override
	public String getValueFromParameter(String parameterName, Entity entity, int index) {
		CodeAttribute attr = (CodeAttribute) getAttributeNodeFromParameter(parameterName, entity, index);
		return attr.getValue().getCode();
	}

	@Override
	public Code createValue(String parameterValue) {
		return new Code(parameterValue);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof CodeAttributeDefinition;
	}

}
