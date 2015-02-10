package org.openforis.collect.earth.core.handlers;

import org.openforis.collect.model.NodeChangeMap;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NumberAttributeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.RealAttribute;
import org.openforis.idm.model.RealValue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class RealAttributeHandler extends AbstractAttributeHandler<RealValue> {

	private static final String PREFIX = "real_";
	private Logger logger = LoggerFactory.getLogger(IntegerAttributeHandler.class);

	public RealAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public NodeChangeSet addToEntity(String parameterName, String parameterValue, Entity entity) {
		NodeChangeSet changeSet = new NodeChangeMap();
		try {
			changeSet = recordUpdater.addAttribute(entity, removePrefix(parameterName), createValue(parameterValue));
//			EntityBuilder.addValue(entity, removePrefix(parameterName), Double.parseDouble(parameterValue));
		} catch (NumberFormatException e) {
			logger.error("The paramater " + parameterName + " was expecting a real number value but got this : " + parameterValue);
		}
		return changeSet;
	}

	@Override
	public String getValueFromParameter(String parameterName, Entity entity, int index) {
		String cleanName = removePrefix(parameterName);
		Double value = ((RealAttribute) entity.get(cleanName
				, index)).getValue().getValue();
		
		return value==null?null:value.toString();
	}

	@Override
	public RealValue createValue(String parameterValue) {
		return new RealValue(Double.parseDouble(parameterValue), null);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof NumberAttributeDefinition && ((NumberAttributeDefinition) def).getType() == Type.REAL;
	}

}
