package org.openforis.collect.earth.ipcc.view;

import java.awt.GridBagConstraints;

import javax.swing.JComboBox;
import javax.swing.JPanel;

import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;
import org.openforis.collect.earth.ipcc.model.VegetationTypeEnum;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public class GrasslandPage extends AbstractSubdivisionPage {

	private static final long serialVersionUID = -2022500980698210420L;
	private AbstractWizardPage nextPage = new SettlementPage();

	public GrasslandPage() {
		super(LandUseCategoryEnum.G);
	}

	@Override
	protected void getMoreInfo(GridBagConstraints constraints, JPanel contentPane,
			AbstractLandUseSubdivision<?> subdiv) {
		constraints.gridx = 4;
		JComboBox<Object> vegetationTypeCombo = new JComboBox(VegetationTypeEnum.values());
		vegetationTypeCombo.setSelectedItem(((GrasslandSubdivision) subdiv).getVegetationType());
		contentPane.add(vegetationTypeCombo, constraints);
		vegetationTypeCombo.addActionListener(e -> {
			GrasslandSubdivision grasslandSub = (GrasslandSubdivision) LandUseSubdivisionUtils.getLandUseSubdivisions()
					.get(LandUseSubdivisionUtils.getLandUseSubdivisions().indexOf(subdiv));
			grasslandSub.setVegetationType((VegetationTypeEnum) vegetationTypeCombo.getSelectedItem());
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
		return Messages.getString("GrasslandPage.0"); //$NON-NLS-1$
	}

}
