package org.openforis.collect.earth.core.handlers;

import org.apache.commons.lang3.StringUtils;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Code;

/**
 * Code attributes. A qualifiable item ( "Other, specify" ) carries the text the interpreter wrote after
 * {@link #QUALIFIER_SEPARATOR} : "other::Eucalyptus". The qualifier used to be dropped both ways, so the text was never
 * saved and Collect reported the item as missing its specification.
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class CodeAttributeHandler extends AbstractAttributeHandler<Code> {

	private static final String PREFIX = "code_";
	/** Between the code and the qualifier. Not ":" alone, which some code lists use in their codes ( "10:30" ) */
	public static final String QUALIFIER_SEPARATOR = "::";

	public CodeAttributeHandler() {
		this(PREFIX);
	}

	public CodeAttributeHandler(String prefix) {
		super(prefix);
	}

	@Override
	public String getParameterValue(Code value) {
		if (value == null || value.getCode() == null) {
			return null;
		}
		return StringUtils.isBlank(value.getQualifier()) ? value.getCode()
				: value.getCode() + QUALIFIER_SEPARATOR + value.getQualifier();
	}

	@Override
	public Code createValue(String parameterValue) {
		int separator = parameterValue.indexOf(QUALIFIER_SEPARATOR);
		if (separator < 0) {
			return new Code(parameterValue);
		}
		String qualifier = parameterValue.substring(separator + QUALIFIER_SEPARATOR.length()).trim();
		return new Code(parameterValue.substring(0, separator), qualifier.isEmpty() ? null : qualifier);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof CodeAttributeDefinition;
	}

}
