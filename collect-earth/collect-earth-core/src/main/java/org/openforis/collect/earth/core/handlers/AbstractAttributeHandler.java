package org.openforis.collect.earth.core.handlers;

import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.model.NodeChangeMap;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.KeyAttributeDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.SpatialReferenceSystem;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Coordinate;
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
		this.recordUpdater.setClearNotRelevantAttributes(true);
		this.recordUpdater.setClearDependentCodeAttributes(true);
	}

	public NodeChangeSet deleteAttributes(String parameterName, Entity entity) {
		NodeChangeMap result = new NodeChangeMap();
		List<Attribute<?, ?>> attributes = getAttributeNodesFromParameter(parameterName, entity);
		for (Attribute<?, ?> attribute : attributes) {
			NodeChangeSet partialChange = recordUpdater.deleteNode(attribute);
			result.addMergeChanges(partialChange);
		}
		return result;
	}
	
	public NodeChangeSet addOrUpdate(String parameterName, String parameterValue, Entity entity, int parameterChildIndex) {
		Value value = (Value) (StringUtils.isBlank(parameterValue) ? null: createValue(parameterValue ) );
		
		if( value instanceof Coordinate){
			// Set the actual SRS used by the survey
			// Only one SRS can be used on the Collect Earth surveys, so get the first one!
			SpatialReferenceSystem usedSrs = entity.getSchema().getSurvey().getSpatialReferenceSystems().get(0);
			// TODO FIX this as soon as Stefano releases 3.9.16
			((Coordinate) value ).setSrsId( usedSrs.getId() );
		}
		
		@SuppressWarnings("unchecked")
		Attribute<?, Value> attr = (Attribute<?, Value>) getAttributeNodeFromParameter(parameterName, entity, parameterChildIndex);

		NodeChangeSet changeSet = null;
		if (attr == null) {
			AttributeDefinition attrDef = getAttributeDefinition(entity, parameterName);
			changeSet = recordUpdater.addAttribute(entity, attrDef.getName(), value);
		} else {
			AttributeDefinition def = attr.getDefinition();
			EntityDefinition parentDef = def.getParentEntityDefinition();
			if (! (parentDef.isEnumerable() && def instanceof KeyAttributeDefinition && parentDef.getKeyAttributeDefinitions().contains(def))) {
				changeSet = recordUpdater.updateAttribute(attr, (Value) value);
			}
		}
		return changeSet;
	}

	public List<Attribute<?, ?>> getAttributeNodesFromParameter(String parameterName, Entity entity) {
		AttributeDefinition attrDef = getAttributeDefinition(entity, parameterName);
		List<Node<?>> children = entity.getChildren(attrDef);
		List<Attribute<?, ?>> result = new ArrayList<Attribute<?,?>>(children.size());
		for (Node<?> child : children) {
			result.add((Attribute<?, ?>) child);
		}
		return result;
	}
	
	public Attribute<?, ?> getAttributeNodeFromParameter(String parameterName, Entity entity, int index) {
		AttributeDefinition attrDef = getAttributeDefinition(entity, parameterName);
		Node<?> node = entity.getChild(attrDef, index);
		return (Attribute<?, ?>) node;
	}

	public AttributeDefinition getAttributeDefinition(Entity parentEntity, String parameterName) {
		String attributeName = removePrefix(parameterName);
		NodeDefinition childDef = parentEntity.getDefinition().getChildDefinition(attributeName);
		return (AttributeDefinition) childDef;
	}
	
	public String getValueFromParameter(String parameterName, Entity entity) {
		List<String> parts = new ArrayList<String>();
		List<Attribute<?, ?>> attributes = getAttributeNodesFromParameter(parameterName, entity);
		for (Attribute<?, ?> attribute : attributes) {
			@SuppressWarnings("unchecked")
			C val = (C) attribute.getValue();
			String parameterValue = getParameterValue(val);
			if (StringUtils.isNotBlank(parameterValue)) {
				parts.add(parameterValue);
			}
		}
		if (parts.isEmpty()) {
			return null;
		} else {
			return StringUtils.join(parts, BalloonInputFieldsUtils.PARAMETER_SEPARATOR);
		}
	}

	public String getValueFromParameter(String parameterName, Entity entity, int index) {
		Attribute<?, ?> attribute = getAttributeNodeFromParameter(parameterName, entity, index);
		@SuppressWarnings("unchecked")
		C value = (C) attribute.getValue();
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
