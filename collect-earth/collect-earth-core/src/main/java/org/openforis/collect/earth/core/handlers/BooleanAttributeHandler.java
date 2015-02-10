package org.openforis.collect.earth.core.handlers;

import org.openforis.collect.model.NodeChangeSet;
import org.openforis.idm.metamodel.BooleanAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.BooleanAttribute;
import org.openforis.idm.model.BooleanValue;
import org.openforis.idm.model.Entity;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class BooleanAttributeHandler extends AbstractAttributeHandler<BooleanValue> {

	private static final String PREFIX = "boolean_";

	public BooleanAttributeHandler() {
		super(PREFIX);
	}

	@Override
	public NodeChangeSet addToEntity(String parameterName, String parameterValue, Entity entity) {
		if( parameterValue.equals("1")){
			parameterValue = "true";
		}else if( parameterValue.equals("0")){
			parameterValue = "false";
		}
		NodeChangeSet changeSet = recordUpdater.addAttribute(entity, removePrefix(parameterName), new BooleanValue(parameterValue));
		return changeSet;
	}

	@Override
	public String getValueFromParameter(String parameterName, Entity entity, int index) {
		Boolean value = ((BooleanAttribute) getAttributeNodeFromParameter(parameterName, entity, index)).getValue().getValue();
		return value == null ? null : value.toString();		
	}
	
	@Override
	public BooleanValue createValue(String parameterValue) {
		return new BooleanValue(parameterValue);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof BooleanAttributeDefinition;
	}
}
