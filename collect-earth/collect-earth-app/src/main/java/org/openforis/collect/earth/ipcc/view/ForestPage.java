package org.openforis.collect.earth.ipcc.view;

import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.ManagementType;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class ForestPage extends SubdivisionPage {

	private static final long serialVersionUID = -1544068125437624279L;
	private AbstractWizardPage nextPage = new CroplandPage();
	
	public ForestPage() {		
		super( LandUseCategory.F );	
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
		return Messages.getString("ForestPage.0"); //$NON-NLS-1$
	}

}
