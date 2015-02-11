package org.openforis.collect.earth.core.handlers;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.model.NodeChangeMap;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;
import org.openforis.idm.model.Node;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class EntityHandler extends AbstractAttributeHandler<Entity> {

	// Expected : colllect_entity_topography[house].code_coverage=XX
	private static final String PREFIX = "entity_";

	private BalloonInputFieldsUtils balloonInputFieldUtils;
	
	public EntityHandler(BalloonInputFieldsUtils balloonInputFieldUtils) {
		super(PREFIX);
		this.balloonInputFieldUtils = balloonInputFieldUtils;
	}

	@Override
	public NodeChangeSet addOrUpdate(String parameterName, String parameterValue, Entity parentEntity, int childParameterIndex) {
		NodeChangeMap result = new NodeChangeMap();
		
		// Expected parameter name:
		// colllect_entity_topography[house].code_coverage=XX
		parameterName = removePrefix(parameterName);
		String childEntityName = getEntityName(parameterName);
		String keyValue = getEntityKey(parameterName);
		String entityAttribute = getNestedAttributeParameterName(parameterName);

		Entity childEntity = getChildEntity(parentEntity, childEntityName, keyValue);
		if (childEntity == null) {
//			childEntity = EntityBuilder.addEntity(parentEntity, childEntityName);
			NodeChangeSet changeSet = recordUpdater.addEntity(parentEntity, childEntityName);
			result.addMergeChanges(changeSet);
		}
		
		Map<String,String> parameters = new HashMap<String, String>();
		parameters.put(entityAttribute, parameterValue);

		NodeChangeSet otherChangeSet = balloonInputFieldUtils.saveToEntity(parameters, childEntity);
		result.addMergeChanges(otherChangeSet);
		return result;
	}
	
	@Override
	protected NodeChangeSet addToEntity(String parameterName, String parameterValue, Entity entity) {
		return new NodeChangeMap();
	}

	@Override
	public String getValueFromParameter(String parameterName, Entity entity, int index) {
//		Attribute<?, ?> attribute = getAttributeNodeFromParameter(parameterName, entity, index);
//		return attribute == null ? null : get;
		return "";
	}
	
	private Entity getChildEntity(Entity parentEntity, String entityName, String entityKey) {
		List<Entity> entities = parentEntity.findChildEntitiesByKeys(entityName, entityKey);
		if (entities.isEmpty()) {
			return null;
		} else {
			return entities.get(0);
		}
//		List<Node<? extends NodeDefinition>> entities = parentEntity.getChildren(entityName);
//		Entity foundEntity = null;
//		if (entities != null) {
//			for (Node<? extends NodeDefinition> entity : entities) {
//				String key = getEntityKey((Entity) entity);
//				if (key != null && key.equals(entityKey)) {
//					foundEntity = (Entity) entity;
//					break;
//				}
//
//			}
//		}
//		return foundEntity;
	}

	@Override
	public Attribute<?, ?> getAttributeNodeFromParameter(String parameterName,
			Entity entity, int index) {
		String cleanName = removePrefix(parameterName);
		String childEntityName = getEntityName(cleanName);
		String keyValue = getEntityKey(cleanName);
		String nestedAttributeParameterName = getNestedAttributeParameterName(cleanName);
		Entity childEntity = getChildEntity(entity, childEntityName, keyValue);
		return balloonInputFieldUtils.getAttributeNodeFromParameter(childEntity, nestedAttributeParameterName, index);
	}

	@Override
	protected Entity createValue(String parameterValue) {
		return EntityBuilder.createEntity(null, parameterValue);
	}

	private String getNestedAttributeParameterName(String parameterName) {
		int indexOfDot = parameterName.indexOf('.');
		return parameterName.substring(indexOfDot + 1);
	}

	public String getEntityKey(Entity entity) {
		String key = null;
		CodeAttributeDefinition enumeratingKeyCodeAttribute = entity.getDefinition().getEnumeratingKeyCodeAttribute();
		CodeAttribute keyAttribute = null;

		List<Node<? extends NodeDefinition>> children = entity.getChildren();
		for (Node<? extends NodeDefinition> child : children) {
			if (child.getName().equals(enumeratingKeyCodeAttribute.getName())) {
				keyAttribute = (CodeAttribute) child;
			}
		}

		if (keyAttribute != null) {
			key = keyAttribute.getValue().getCode();
		}

		return key;
	}

	private String getEntityKey(String parameterName) {
		int indexOfKeyStart = parameterName.indexOf("[");
		int indexOfKeyEnd = parameterName.indexOf("]");
		return parameterName.substring(indexOfKeyStart + 1, indexOfKeyEnd);
	}

	// topography[house].code_coverage=XX
	private String getEntityName(String parameterName) {
		int indexOfKey = parameterName.indexOf("[");
		return parameterName.substring(0, indexOfKey);
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof EntityDefinition;
	}

	@Override
	public boolean isMultiValueAware() {
		return true;
	}
}
