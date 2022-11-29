package org.openforis.collect.model.proxy;

import java.util.Map;

import org.openforis.collect.ProxyContext;
import org.openforis.collect.model.AttributeChange;
import org.openforis.idm.model.Attribute;

/**
 * 
 * @author S. Ricci
 *
 */
public class AttributeChangeProxy extends NodeChangeProxy<AttributeChange> {

	public AttributeChangeProxy(AttributeChange change, ProxyContext context) {
		super(change, context);
	}

	public ValidationResultsProxy getValidationResults() {
		if ( change.getValidationResults() == null ) {
			return null;
		} else {
			return new ValidationResultsProxy(context, (Attribute<?, ?>) change.getNode(), change.getValidationResults());
		}
	}

	public Map<Integer, Object> getUpdatedFieldValues() {
		return change.getUpdatedFieldValues();
	}
	
}