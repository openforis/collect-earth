package org.openforis.eye.service;

import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;

public abstract class AbstractAttributeHandler {

	private String prefix;

	public AbstractAttributeHandler(String prefix) {
		super();
		this.prefix = prefix;
	}

	public abstract void addToEntity(String parameterName, String parameterValue, Entity entity);

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
