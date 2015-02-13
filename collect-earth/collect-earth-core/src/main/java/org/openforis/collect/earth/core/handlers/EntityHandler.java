package org.openforis.collect.earth.core.handlers;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.model.NodeChangeMap;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.EntityBuilder;

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
	public String getParameterValue(Entity value) {
		return null;
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

	private Entity getChildEntity(Entity parentEntity, String entityName, String entityKey) {
		List<Entity> entities = parentEntity.findChildEntitiesByKeys(entityName, entityKey);
		if (entities.isEmpty()) {
			return null;
		} else {
			return entities.get(0);
		}
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
