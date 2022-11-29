package org.openforis.collect.earth.ipcc.view;

import org.openforis.collect.earth.ipcc.model.CroplandType;
import org.openforis.collect.earth.ipcc.model.LandUseCategory;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class CroplandPage extends SubdivisionPage {


	private static final long serialVersionUID = -8470656687978500741L;
	private AbstractWizardPage nextPage = new GrasslandPage();
	
	public CroplandPage() {		
		super( LandUseCategory.C );	
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
		return CroplandType.values();
	}

	@Override
	protected String getLabel() {
		return Messages.getString("CroplandPage.0"); //$NON-NLS-1$
	}

}
