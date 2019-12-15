package org.openforis.collect.model.proxy;

import java.util.HashMap;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;

import org.openforis.collect.ProxyContext;
import org.openforis.collect.model.EntityChange;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.validation.ValidationResultFlag;

/**
 * 
 * @author S. Ricci
 *
 */
public class EntityChangeProxy extends NodeChangeProxy<EntityChange> {

	public EntityChangeProxy(EntityChange change, ProxyContext context) {
		super(change, context);
	}

	public Map<Integer, Boolean> getRelevant() {
		return convertToChildDefinitionIdMap(change.getChildrenRelevance());
	}

	public Map<Integer, Integer> getMinCountByChildDefinitionId() {
		return change.getMinCountByChildDefinitionId();
	}

	public Map<Integer, Integer> getMaxCountByChildDefinitionId() {
		return change.getMaxCountByChildDefinitionId();
	}

	public Map<Integer, ValidationResultFlag> getMinCountValidation() {
		return convertToChildDefinitionIdMap(change.getChildrenMinCountValidation());
	}

	public Map<Integer, ValidationResultFlag> getMaxCountValidation() {
		return convertToChildDefinitionIdMap(change.getChildrenMaxCountValidation());
	}

	private <V extends Object> Map<Integer, V> convertToChildDefinitionIdMap(Map<String, V> from) {
		EntityDefinition entityDef = change.getNode().getDefinition();
		Map<Integer, V> map = new HashMap<>();
		Set<Entry<String, V>> entries = from.entrySet();
		for (Entry<String, V> entry : entries) {
			String childName = entry.getKey();
			Integer childDefId = entityDef.getChildDefinition(childName).getId();
			map.put(childDefId, entry.getValue());
		}
		return map;
	}

}