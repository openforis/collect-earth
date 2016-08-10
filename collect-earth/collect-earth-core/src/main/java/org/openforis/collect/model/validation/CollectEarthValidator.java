package org.openforis.collect.model.validation;

import org.springframework.stereotype.Component;

@Component
public class CollectEarthValidator extends CollectValidator {

	public CollectEarthValidator() {
		super();
		setValidateSpecified(false);
	}
	
}
