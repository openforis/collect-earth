package org.openforis.collect.earth.ipcc.view;

import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.ManagementType;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class OtherlandPage extends SubdivisionPage {

	private static final long serialVersionUID = -7092466238152990994L;
	//private AbstractWizardPage nextPage;
	
	public OtherlandPage() {		
		super( LandUseCategory.O );	
	}

	@Override
	protected AbstractWizardPage getNextPage() {
		return null;
	}


	@Override
	protected boolean isFinishAllowed() {
		return true;
	}

	@Override
	protected Object[] getValues() {
		return ManagementType.values();
	}

	@Override
	protected String getLabel() {
		return Messages.getString("OtherlandPage.0"); //$NON-NLS-1$
	}

}
