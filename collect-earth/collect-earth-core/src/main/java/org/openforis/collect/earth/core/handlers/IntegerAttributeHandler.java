package org.openforis.collect.earth.core.handlers;

import org.openforis.collect.model.NodeChangeMap;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.IntegerAttribute;
import org.openforis.idm.model.IntegerValue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class IntegerAttributeHandler extends AbstractAttributeHandler<IntegerValue> {

	private static final String PREFIX = "integer_";
	private Logger logger = LoggerFactory.getLogger(IntegerAttributeHandler.class);

	public IntegerAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public NodeChangeSet addToEntity(String parameterName, String parameterValue, Entity entity) {
		NodeChangeSet changeSet = new NodeChangeMap();
		try {
			changeSet = recordUpdater.addAttribute(entity, removePrefix(parameterName), getAttributeValue(parameterValue));
//			EntityBuilder.addValue(entity, removePrefix(parameterName), Integer.parseInt(parameterValue));
		} catch (NumberFormatException e) {
			logger.error("The paramater " + parameterName + " was expecting an integer value but got this : " + parameterValue);
		}
		return changeSet;
	}

	@Override
	public String getAttributeFromParameter(String parameterName, Entity entity, int index) {
		String cleanName = removePrefix(parameterName);
		Integer value = ((IntegerAttribute) entity.get(cleanName, index)).getValue().getValue();
		return value==null?null:value.toString();
	}

	@Override
	public IntegerValue getAttributeValue(String parameterValue) {
		return new IntegerValue(Integer.parseInt(parameterValue), null);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof NumberAttributeDefinition && ((NumberAttributeDefinition) def).getType() == Type.INTEGER;
	}

}
