package org.openforis.collect.earth.ipcc.view;

import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.awt.event.WindowListener;
import java.util.ArrayList;
import java.util.List;

import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandType;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.ManagementType;
import org.openforis.collect.earth.ipcc.model.OtherlandSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementType;
import org.openforis.collect.earth.ipcc.model.WetlandSubdivision;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import se.gustavkarlsson.gwiz.AbstractWizardPage;
import se.gustavkarlsson.gwiz.WizardController;

public class AssignSubdivisionTypesWizard {

	JDialogWizard wizard ;
	private Logger logger = LoggerFactory.getLogger( AssignSubdivisionTypesWizard.class);
	
	public void initializeTypes(List<LandUseSubdivision> landUseSubdivisions ) {

		LandUseSubdivisionUtils.setLandUseSubdivisions(landUseSubdivisions);
		
		// Create a new wizard (this one is based on a JFrame)
		wizard = new JDialogWizard(null, "Assign Management Type", true);
		
		wizard.addWindowListener( new WindowAdapter() {
			public void windowClosing(WindowEvent e) {
				if( !isWizardFinished() ) {
					try {
						SwingUtilities.invokeLater(
								() -> JOptionPane.showMessageDialog(wizard, 
										"You need to assign management types for all subdivisions and then click on \"Finnish\" to proceed" , 
										"Closing without finishing assginament of subdivisions", JOptionPane.WARNING_MESSAGE)
						);
					} catch (Exception ex) {
						logger.error("Error showing message",ex);
					}
				}
			}
		});

		// Create the first page of the wizard
		AbstractWizardPage forestPage = new ForestPage();

		// Create the controller for wizard
		WizardController wizardController = new WizardController(wizard);

		// Start the wizard and show it
		wizardController.startWizard(forestPage);
		wizard.setVisible(true);

	}
	
	public boolean isWizardFinished() {
		return wizard.isWizardFinished();
	}

	public static void main(String[] args) {

		List<LandUseSubdivision> luses = new ArrayList();

		luses.add( new ForestSubdivision("a", "aaaaa", ManagementType.MANAGED ) ) ;
		luses.add( new ForestSubdivision("a", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("c", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("a", "aaaaa", ManagementType.MANAGED ) ) ;
		luses.add( new ForestSubdivision("a", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("c", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("a", "aaaaa", ManagementType.MANAGED ) ) ;
		luses.add( new ForestSubdivision("a", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("c", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("a", "aaaaa", ManagementType.MANAGED ) ) ;
		luses.add( new ForestSubdivision("a", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("c", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new ForestSubdivision("f", "aaaaa", ManagementType.MANAGED ) );

		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandType.ANNUAL ) ) ;
		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("c", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandType.ANNUAL ) ) ;
		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("c", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandType.ANNUAL ) ) ;
		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("c", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandType.ANNUAL ) ) ;
		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("c", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandType.ANNUAL ) );
		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandType.ANNUAL ) );

		luses.add( new WetlandSubdivision("a", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new WetlandSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new WetlandSubdivision("c", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new WetlandSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new WetlandSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new WetlandSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		
		luses.add( new GrasslandSubdivision("a", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new GrasslandSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new GrasslandSubdivision("c", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new GrasslandSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new GrasslandSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new GrasslandSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		
		luses.add( new OtherlandSubdivision("a", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new OtherlandSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new OtherlandSubdivision("c", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new OtherlandSubdivision("f", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new OtherlandSubdivision("b", "aaaaa", ManagementType.MANAGED ) );
		luses.add( new OtherlandSubdivision("f", "aaaaa", ManagementType.MANAGED ) );

		luses.add( new SettlementSubdivision("a", "aaaaa", SettlementType.TREED ) );
		luses.add( new SettlementSubdivision("b", "aaaaa", SettlementType.TREED ) );
		luses.add( new SettlementSubdivision("c", "aaaaa", SettlementType.TREED ) );
		luses.add( new SettlementSubdivision("f", "aaaaa", SettlementType.TREED ) );
		luses.add( new SettlementSubdivision("b", "aaaaa", SettlementType.OTHER ) );
		luses.add( new SettlementSubdivision("f", "aaaaa", SettlementType.OTHER ) );
		
		AssignSubdivisionTypesWizard wizard = new AssignSubdivisionTypesWizard();

		wizard.initializeTypes(luses);
	}

}


