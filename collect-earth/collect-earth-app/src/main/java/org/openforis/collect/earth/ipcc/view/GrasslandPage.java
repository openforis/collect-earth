package org.openforis.collect.earth.ipcc.view;

import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.ManagementType;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class GrasslandPage extends SubdivisionPage {


	private static final long serialVersionUID = -2022500980698210420L;
	private AbstractWizardPage nextPage = new SettlementPage();
	
	public GrasslandPage() {		
		super( LandUseCategory.G );	
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
		return "Grassland subdivisions / Management";
	}

}
