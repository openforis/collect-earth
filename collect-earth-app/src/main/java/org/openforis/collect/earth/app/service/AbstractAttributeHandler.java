package org.openforis.collect.earth.app.service;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.Value;

public abstract class AbstractAttributeHandler {

	private String prefix;

	public AbstractAttributeHandler(String prefix) {
		super();
		this.prefix = prefix;
	}

	public void addOrUpdate(String parameterName, String parameterValue, Entity entity) {

		String idmName = removePrefix(parameterName);
		Node<? extends NodeDefinition> node = entity.get(idmName, 0);
		if (parameterValue.trim().length() == 0) {
			if (entity.get(idmName, 0) != null) {
				entity.remove(idmName, 0);
			}
		} else {
			if (node == null) {
				if (parameterValue.length() > 0) {
					addToEntity(parameterName, parameterValue, entity);
				}
			} else {
				Attribute attribute = (Attribute) entity.get(idmName, 0);
				attribute.setValue(getAttributeValue(parameterValue));
			}
		}

	}

	protected abstract Value getAttributeValue(String parameterValue);

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
	
	public abstract boolean isAttributeParseable(Attribute value);
	
	public void setPrefix(String prefix) {
		this.prefix = prefix;
	}

	protected String removePrefix(String parameterName) {

		return parameterName.substring(prefix.length());

	}
}
