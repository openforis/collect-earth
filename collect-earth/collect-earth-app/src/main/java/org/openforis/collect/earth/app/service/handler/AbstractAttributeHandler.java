package org.openforis.collect.earth.app.service.handler;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.Value;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public abstract class AbstractAttributeHandler<C> {

	private String prefix;

	public AbstractAttributeHandler(String prefix) {
		super();
		this.prefix = prefix;
	}

	public void addOrUpdate(String parameterName, String parameterValue, Entity entity, int parameterChildIndex) {

		String cleanParameterName = removePrefix(parameterName);
		Node<? extends NodeDefinition> node = entity.get(cleanParameterName, parameterChildIndex);

		if (parameterValue.trim().length() > 0) {
			if (node == null) {
				addToEntity(parameterName, parameterValue, entity);
			} else if (node instanceof Attribute) {
				Attribute attribute = (Attribute) entity.get(cleanParameterName, parameterChildIndex);
				attribute.setValue((Value) getAttributeValue(parameterValue));
				attribute.updateSummaryInfo();
			}
		}
	}

	protected abstract void addToEntity(String parameterName, String parameterValue, Entity entity);

	public String getAttributeFromParameter(String parameterName, Entity entity) {
		return getAttributeFromParameter(parameterName, entity, 0);
	}

	public abstract String getAttributeFromParameter(String parameterName, Entity entity, int index);

	protected abstract C getAttributeValue(String parameterValue);

	public String getPrefix() {
		return prefix;
	}

	public boolean isParameterParseable(String parameterName) {
		return parameterName.startsWith(getPrefix());
	}

	public abstract boolean isParseable(Node value);

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
