package org.openforis.collect.earth.ipcc.view;

import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.SettlementType;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class SettlementPage extends SubdivisionPage {


	private static final long serialVersionUID = 1548578357804057242L;
	private AbstractWizardPage nextPage = new WetlandPage();
	
	public SettlementPage() {		
		super( LandUseCategory.S );	
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
		return SettlementType.values();
	}

	@Override
	protected String getLabel() {
		return Messages.getString("SettlementPage.0"); //$NON-NLS-1$
	}

}
