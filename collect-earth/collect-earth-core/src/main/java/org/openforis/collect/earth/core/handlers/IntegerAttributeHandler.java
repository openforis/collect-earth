package org.openforis.collect.earth.core.handlers;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.IntegerAttribute;
import org.openforis.idm.model.IntegerValue;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class IntegerAttributeHandler extends AbstractAttributeHandler<IntegerValue> {

	private static final String PREFIX = "integer_";

	public IntegerAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public String getValueFromParameter(String parameterName, Entity entity, int index) {
		String cleanName = removePrefix(parameterName);
		Integer value = ((IntegerAttribute) entity.get(cleanName, index)).getValue().getValue();
		return value==null?null:value.toString();
	}

	@Override
	public IntegerValue createValue(String parameterValue) {
		return new IntegerValue(Integer.parseInt(parameterValue), null);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof NumberAttributeDefinition && ((NumberAttributeDefinition) def).getType() == Type.INTEGER;
	}

}
