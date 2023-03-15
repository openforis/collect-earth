package org.openforis.collect.earth.ipcc.view;

import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.util.List;

import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;

import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;

import se.gustavkarlsson.gwiz.AbstractWizardPage;

public abstract class AbstractSubdivisionPage extends AbstractWizardPage {
	
	public AbstractSubdivisionPage( LandUseCategoryEnum category) {
		
		List<AbstractLandUseSubdivision<?>> subdivisionsInCategory = LandUseSubdivisionUtils.getSubdivisionsByCategory( category );
		
		final GridBagConstraints constraints = new GridBagConstraints();
		constraints.gridx = 0;
		constraints.gridy = 0;
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.insets = new Insets(5, 5, 5, 5);
		constraints.weightx = 1.0;
		constraints.fill = GridBagConstraints.HORIZONTAL;
		
		JPanel contentPane = new JPanel(new GridBagLayout());
        JScrollPane scrollPane = new JScrollPane(contentPane);
        scrollPane.setHorizontalScrollBarPolicy(JScrollPane.HORIZONTAL_SCROLLBAR_AS_NEEDED);
        scrollPane.setVerticalScrollBarPolicy(JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED);
        scrollPane.setBounds(50, 30, 300, 50);
        scrollPane.setPreferredSize(new Dimension(450, 350));
        
		final Border border = new TitledBorder(
				new BevelBorder(BevelBorder.LOWERED),
				getLabel());
		setBorder(border);

		for (AbstractLandUseSubdivision<?> subdiv : subdivisionsInCategory) {
			
			constraints.gridx = 0;
			
			JLabel labelCode = new JLabel( subdiv.getCode() );
			contentPane.add(labelCode, constraints);
			
			constraints.gridx = 1;
			
			JLabel labelName = new JLabel( subdiv.getName());
			contentPane.add(labelName, constraints);

			constraints.gridx = 2;
			JComboBox<Object> mgmtType = new JComboBox(getValues());
			mgmtType.setSelectedItem( subdiv.getManagementType() );
			contentPane.add(mgmtType, constraints);
			mgmtType.addActionListener( e->
				LandUseSubdivisionUtils.setSubdivisionType( subdiv, mgmtType.getSelectedItem() )
			);
			
			constraints.gridy++;
		}
        
        this.add(scrollPane);
		
		

	}


	protected abstract String getLabel();


	protected abstract Object[] getValues();


	@Override
	protected boolean isCancelAllowed() {
		return false;
	}

	@Override
	protected boolean isPreviousAllowed() {
		return true;
	}

	@Override
	protected boolean isNextAllowed() {
		return true;
	}

	@Override
	protected boolean isFinishAllowed() {
		return false;
	}

}
