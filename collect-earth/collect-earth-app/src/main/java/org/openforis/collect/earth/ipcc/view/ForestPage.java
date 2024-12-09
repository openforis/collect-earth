package org.openforis.collect.earth.ipcc.view;

import java.awt.GridBagConstraints;

import javax.swing.JComboBox;
import javax.swing.JPanel;

import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestTypeEnum;
import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class ForestPage extends AbstractSubdivisionPage {

	private static final long serialVersionUID = -1544068125437624279L;
	private AbstractWizardPage nextPage = new CroplandPage();
	
	public ForestPage() {		
		super( LandUseCategoryEnum.F );	
	}

	@Override
	protected void getMoreInfo(GridBagConstraints constraints, JPanel contentPane, AbstractLandUseSubdivision<?> subdiv, JComboBox<Object> mgmtType) {
		constraints.gridx = 4;
		JComboBox<Object> forestType = new JComboBox( ForestTypeEnum.values() );
		forestType.setSelectedItem( ( (ForestSubdivision) subdiv ).getForestType() );
		contentPane.add(forestType, constraints);
		forestType.addActionListener( e->{
			ForestSubdivision forestSub =  (ForestSubdivision) LandUseSubdivisionUtils.getLandUseSubdivisions().get( LandUseSubdivisionUtils.getLandUseSubdivisions().indexOf(subdiv));
			forestSub.setForestType( (ForestTypeEnum) forestType.getSelectedItem() );
		});
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
		return Messages.getString("ForestPage.0"); //$NON-NLS-1$
	}

}
