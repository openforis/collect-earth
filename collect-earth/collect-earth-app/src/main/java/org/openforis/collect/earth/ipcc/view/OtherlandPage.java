package org.openforis.collect.earth.ipcc.view;

import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class OtherlandPage extends AbstractSubdivisionPage {

	private static final long serialVersionUID = -7092466238152990994L;
	//private AbstractWizardPage nextPage;
	
	public OtherlandPage() {		
		super( LandUseCategoryEnum.O );	
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
		return ManagementTypeEnum.values();
	}

	@Override
	protected String getLabel() {
		return Messages.getString("OtherlandPage.0"); //$NON-NLS-1$
	}

}
