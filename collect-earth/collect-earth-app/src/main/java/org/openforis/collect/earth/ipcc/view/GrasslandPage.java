package org.openforis.collect.earth.ipcc.view;

import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class GrasslandPage extends AbstractSubdivisionPage {


	private static final long serialVersionUID = -2022500980698210420L;
	private AbstractWizardPage nextPage = new SettlementPage();
	
	public GrasslandPage() {		
		super( LandUseCategoryEnum.G );	
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
		return Messages.getString("GrasslandPage.0"); //$NON-NLS-1$
	}

}
