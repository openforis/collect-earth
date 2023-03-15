package org.openforis.collect.earth.ipcc.view;

import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class WetlandPage extends AbstractSubdivisionPage {

	private static final long serialVersionUID = 5385335458259411328L;
	private AbstractWizardPage nextPage = new OtherlandPage();
	
	public WetlandPage() {		
		super( LandUseCategoryEnum.W );	
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
		return ManagementTypeEnum.values();
	}

	@Override
	protected String getLabel() {
		return Messages.getString("WetlandPage.0"); //$NON-NLS-1$
	}

}
