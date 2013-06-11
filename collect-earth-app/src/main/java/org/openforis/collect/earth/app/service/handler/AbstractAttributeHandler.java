package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.Value;

public abstract class AbstractAttributeHandler<C> {

	private String prefix;

	public AbstractAttributeHandler(String prefix) {
		super();
		this.prefix = prefix;
	}

	public void addOrUpdate(String parameterName, String parameterValue, Entity entity) {

		String idmName = removePrefix(parameterName);
		Node<? extends NodeDefinition> node = entity.get(idmName, 0);
		/*
		 * if (parameterValue.trim().length() == 0) { if (entity.get(idmName, 0)
		 * != null) { entity.remove(idmName, 0); } } else {
		 */

		// if (node instanceof Attribute) {
		if (node == null) {
			if (parameterValue.trim().length() > 0) {
				addToEntity(parameterName, parameterValue, entity);
			}
		} else if (node instanceof Attribute) {
			if (parameterValue.trim().length() == 0) {
				// entity.remove(removePrefix(parameterName), 0);
			} else {
				Attribute attribute = (Attribute) entity.get(idmName, 0);
				attribute.setValue((Value) getAttributeValue(parameterValue));
			}
		}
		/*
		 * } else if (node instanceof Entity) { int count =
		 * entity.getCount("topography"); for (int i = 0; i < count; i++) {
		 * entity.remove("topography", 0); }
		 * 
		 * EntityBuilder.addEntity(entity, "topography"); }
		 */


		/* } */

	}

	protected abstract C getAttributeValue(String parameterValue);

	protected abstract void addToEntity(String parameterName, String parameterValue, Entity entity);

	public abstract String getAttributeFromParameter(String parameterName, Entity entity, int index);

	public String getAttributeFromParameter(String parameterName, Entity entity) {
		return getAttributeFromParameter(parameterName, entity, 0);
	}

	public String getPrefix() {
		return prefix;
	}

	public boolean isParameterParseable(String parameterName) {
		return parameterName.startsWith(getPrefix());
	}
	
	public abstract boolean isParseable(Node value);
	
	public void setPrefix(String prefix) {
		this.prefix = prefix;
	}

	protected String removePrefix(String parameterName) {
		if (parameterName.startsWith(prefix)) {
			return parameterName.substring(prefix.length());
		}else{
			return parameterName;
		}

	}
}
