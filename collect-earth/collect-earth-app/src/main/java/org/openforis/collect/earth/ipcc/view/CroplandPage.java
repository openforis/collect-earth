package org.openforis.collect.earth.ipcc.view;

import java.awt.GridBagConstraints;

import javax.swing.JComboBox;
import javax.swing.JPanel;

import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandTypeEnum;
import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.PerennialCropTypesEnum;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class CroplandPage extends AbstractSubdivisionPage {


	private static final long serialVersionUID = -8470656687978500741L;
	private AbstractWizardPage nextPage = new GrasslandPage();
	
	public CroplandPage() {		
		super( LandUseCategoryEnum.C );	
	}

	@Override
	protected void getMoreInfo(GridBagConstraints constraints, JPanel contentPane, AbstractLandUseSubdivision<?> subdiv, JComboBox<Object> mgmtType) {
		constraints.gridx = 4;
		JComboBox<Object> perennialCropTypes = new JComboBox( PerennialCropTypesEnum.values() );
		perennialCropTypes.setSelectedItem( ( (CroplandSubdivision) subdiv ).getPerennialCropType() );
		contentPane.add(perennialCropTypes, constraints);
		perennialCropTypes.addActionListener( e-> {
				CroplandSubdivision croplandSud =  (CroplandSubdivision) LandUseSubdivisionUtils.getLandUseSubdivisions().get( LandUseSubdivisionUtils.getLandUseSubdivisions().indexOf(subdiv));
				croplandSud.setPerennialCropType( (PerennialCropTypesEnum) perennialCropTypes.getSelectedItem() );
			} 
		);
		
		perennialCropTypes.setEnabled( mgmtType.getSelectedItem().equals(CroplandTypeEnum.PERENNIAL ) );
		
		// Only enable for perennial management type of crops
		mgmtType.addActionListener( e ->  perennialCropTypes.setEnabled( mgmtType.getSelectedItem().equals(CroplandTypeEnum.PERENNIAL ) ) );
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
		return CroplandTypeEnum.values();
	}

	@Override
	protected String getLabel() {
		return Messages.getString("CroplandPage.0"); //$NON-NLS-1$
	}

}
