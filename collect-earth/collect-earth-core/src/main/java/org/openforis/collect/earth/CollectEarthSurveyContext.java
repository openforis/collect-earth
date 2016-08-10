package org.openforis.collect.earth;

import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.idm.metamodel.CodeListService;
import org.openforis.idm.metamodel.validation.Validator;
import org.openforis.idm.model.expression.ExpressionFactory;

public class CollectEarthSurveyContext extends CollectSurveyContext {

	private static final long serialVersionUID = 1L;

	public CollectEarthSurveyContext(ExpressionFactory expressionFactory, Validator validator,
			CodeListService codeListService) {
		super(expressionFactory, validator, codeListService);
	}

	
}
