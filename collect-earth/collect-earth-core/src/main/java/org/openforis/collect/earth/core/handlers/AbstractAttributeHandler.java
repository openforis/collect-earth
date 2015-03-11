package org.openforis.collect.earth.core.handlers;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.KeyAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.Value;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public abstract class AbstractAttributeHandler<C> {

	private String prefix;
	
	protected RecordUpdater recordUpdater;

	public AbstractAttributeHandler(String prefix) {
		super();
		this.prefix = prefix;
		this.recordUpdater = new RecordUpdater();
	}

	public NodeChangeSet addOrUpdate(String parameterName, String parameterValue, Entity entity, int parameterChildIndex) {
		Value value = (Value) (StringUtils.isBlank(parameterValue) ? null: createValue(parameterValue));
		
		@SuppressWarnings("unchecked")
		Attribute<?, Value> attr = (Attribute<?, Value>) getAttributeNodeFromParameter(parameterName, entity, parameterChildIndex);

		NodeChangeSet changeSet = null;
		if (attr == null) {
			changeSet = recordUpdater.addAttribute(entity, removePrefix(parameterName), value);
		} else {
			AttributeDefinition def = attr.getDefinition();
			EntityDefinition parentDef = def.getParentEntityDefinition();
			if (! (parentDef.isEnumerable() && def instanceof KeyAttributeDefinition && parentDef.getKeyAttributeDefinitions().contains(def))) {
				changeSet = recordUpdater.updateAttribute(attr, (Value) value, true);
			}
		}
		return changeSet;
	}

	public Attribute<?, ?> getAttributeNodeFromParameter(String parameterName, Entity entity, int index) {
		String cleanName = removePrefix(parameterName);
		Pattern attributeInsideMultipleEntityPattern = Pattern.compile("(\\w+)\\[(\\w+)\\]\\.(\\w*)");
		Matcher matcher = attributeInsideMultipleEntityPattern.matcher(cleanName);
		String attributeName;
		Entity actualEntity;
		if (matcher.matches()) {
			String entityName = matcher.group(1);
			String keyValue = matcher.group(2);
			attributeName = matcher.group(3);
			List<Entity> nestedEntities = entity.findChildEntitiesByKeys(entityName, keyValue);
			actualEntity = nestedEntities.get(0);
		} else {
			attributeName = cleanName;
			actualEntity = entity;
		}
		Node<?> node = actualEntity.getChild(attributeName, index);
		return (Attribute<?, ?>) node;
	}

	public String getValueFromParameter(String parameterName, Entity entity) {
		return getValueFromParameter(parameterName, entity, 0);
	}

	public String getValueFromParameter(String parameterName, Entity entity, int index) {
		@SuppressWarnings("unchecked")
		C value = (C) getAttributeNodeFromParameter(parameterName, entity, index).getValue();
		return getParameterValue(value);
	}

	public abstract String getParameterValue(C value);
	
	protected abstract C createValue(String parameterValue);

	public String getPrefix() {
		return prefix;
	}

	public boolean isParameterParseable(String parameterName) {
		return parameterName.startsWith(getPrefix());
	}

	public boolean isParseable(Node<?> value) {
		return isParseable(value.getDefinition());
	}

	public abstract boolean isParseable(NodeDefinition def);
	
	protected String removePrefix(String parameterName) {
		if (parameterName.startsWith(prefix)) {
			return parameterName.substring(prefix.length());
		} else {
			return parameterName;
		}

	}

	public void setPrefix(String prefix) {
		this.prefix = prefix;
	}

	public boolean isMultiValueAware(){
		return false;
	}
}
