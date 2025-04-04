package org.openforis.collect.earth.core.handlers;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.openforis.collect.earth.core.utils.CollectSurveyUtils;
import org.openforis.collect.model.EntityAddChange;
import org.openforis.collect.model.NodeChange;
import org.openforis.collect.model.NodeChangeMap;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Entity;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class EntityHandler extends AbstractAttributeHandler<Entity> {

	private static final Pattern PARAMETER_NAME_PATTERN = Pattern.compile("(\\w+)(\\[([\\w|-]+)\\])?\\.(\\w+)");
	
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
		// collect_entity_topography[house].code_coverage=XX or collect_entity_topography[2].code_coverage=XX
		Entity childEntity = getChildEntity(parameterName, parentEntity, true);
		Map<String,String> parameters = new HashMap<String, String>();
		String childAttributeParameter = extractNestedAttributeParameterName(parameterName);
		parameters.put(childAttributeParameter, parameterValue);

		NodeChangeSet otherChangeSet = balloonInputFieldUtils.saveToEntity(parameters, childEntity);
		result.addMergeChanges(otherChangeSet);
		return result;
	}
	
	public Entity getChildEntity(String parameterName, Entity parentEntity) {
		return getChildEntity(parameterName, parentEntity, false);
	}

	public Entity getChildEntity(String parameterName, Entity parentEntity, boolean createIfMissing) {
		String cleanName = removePrefix(parameterName);
		String childEntityName = getEntityName(cleanName);
		EntityDefinition childEntityDef = (EntityDefinition) parentEntity.getDefinition().getChildDefinition(childEntityName);
		Entity childEntity;
		if (childEntityDef.isMultiple()) {
			String keyValueOrIndex = getEntityKey(cleanName);
			CodeAttributeDefinition keyCodeAttribute = childEntityDef.getEnumeratingKeyCodeAttribute();
			if (keyCodeAttribute == null) {
				int childIndex = Integer.parseInt(keyValueOrIndex);
				childEntity = parentEntity.getChild(childEntityName, childIndex);
				if (childEntity == null && createIfMissing) {
					NodeChangeSet changeSet = recordUpdater.addEntity(parentEntity, childEntityName);
					List<NodeChange<?>> changes = changeSet.getChanges();
					for (NodeChange<?> nodeChange : changes) {
						if (nodeChange instanceof EntityAddChange) {
							childEntity = (Entity) nodeChange.getNode(); 
						}
					}
				}
			} else {
				childEntity = CollectSurveyUtils.getChildEntity(parentEntity, childEntityName, keyValueOrIndex);
				if (childEntity == null) {
					throw new IllegalStateException(String.format("Enumerated entity expected but not found: %s[%s]", childEntityName, keyValueOrIndex));
				}
			}
		} else {
			childEntity = (Entity) parentEntity.getChild(childEntityDef);
		}
		return childEntity;
	}
	
	
	@Override
	public String getParameterValue(Entity value) {
		throw new UnsupportedOperationException("Cannot create a value for a Entity object");
	}

	@Override
	protected Entity createValue(String parameterValue) {
		throw new UnsupportedOperationException("Cannot create enumerated entities, they should be automatically initialized by RecordManager");
	}

	public String extractNestedAttributeParameterName(String parameterName) {
		return extractParameterPart(parameterName, 4);
	}

	private String getEntityKey(String parameterName) {
		return extractParameterPart(parameterName, 3);
	}

	// topography[house].code_coverage=XX
	private String getEntityName(String parameterName) {
		return extractParameterPart(parameterName, 1);
	}

	private String extractParameterPart(String parameterName, int index) {
		Matcher matcher = PARAMETER_NAME_PATTERN.matcher(parameterName);
		if (matcher.matches()) {
			String part = matcher.group(index);
			return part;
		} else {
			throw new IllegalArgumentException("Unexpected parameter format: " + parameterName);
		}
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
