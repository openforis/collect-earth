package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Code;

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
	public String getParameterValue(Code value) {
		return value == null || value.getCode() == null ? null: value.getCode();
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
