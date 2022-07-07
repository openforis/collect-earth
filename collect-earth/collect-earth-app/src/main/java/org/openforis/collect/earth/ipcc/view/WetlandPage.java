package org.openforis.collect.earth.ipcc.view;

import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.ManagementType;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class WetlandPage extends SubdivisionPage {

	private static final long serialVersionUID = 5385335458259411328L;
	private AbstractWizardPage nextPage = new OtherlandPage();
	
	public WetlandPage() {		
		super( LandUseCategory.W );	
	}

	@Override
	protected AbstractWizardPage getNextPage() {
		return nextPage;
	}


	@Override
	protected boolean isFinishAllowed() {
		return false;
	}

	@Override
	protected Object[] getValues() {
		return ManagementType.values();
	}

	@Override
	protected String getLabel() {
		return "Wetland subdivisions / tree presence";
	}

}
