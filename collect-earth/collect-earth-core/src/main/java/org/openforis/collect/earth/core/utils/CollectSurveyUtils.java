package org.openforis.collect.earth.core.utils;

import java.util.ArrayList;
import java.util.List;

import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CodeListItem;
import org.openforis.idm.metamodel.CodeListService;
import org.openforis.idm.model.Entity;

public abstract class CollectSurveyUtils {

	public static List<String> getEnumeratingCodes(CodeAttributeDefinition keyCodeAttribute) {
		CodeListService codeListService = keyCodeAttribute.getSurvey().getContext().getCodeListService();
		List<String> result = new ArrayList<String>();
		CodeList enumeratingList = keyCodeAttribute.getList();
		List<CodeListItem> enumeratingItems = codeListService.loadRootItems(enumeratingList);
		for (CodeListItem enumeratingItem : enumeratingItems) {
			result.add(enumeratingItem.getCode());
		}
		return result;
	}

	public static Entity getChildEntity(Entity parentEntity, String entityName, String entityKey) {
		List<Entity> entities = parentEntity.findChildEntitiesByKeys(entityName, entityKey);
		return entities.isEmpty() ? null : entities.get(0);
	}

}
