package org.openforis.collect.earth.ipcc.view;

import java.util.ArrayList;
import java.util.List;

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

import se.gustavkarlsson.gwiz.AbstractWizardPage;
import se.gustavkarlsson.gwiz.WizardController;
import se.gustavkarlsson.gwiz.wizards.JFrameWizard;

public class AssignSubdivisionTypesWizard {


	public List<LandUseSubdivision> initializeTypes(List<LandUseSubdivision> landUseSubdivisions ) {

		LandUseSubdivisionUtils.setLandUseSubdivisions(landUseSubdivisions);
		
		// Create a new wizard (this one is based on a JFrame)
		JFrameWizard wizard = new JFrameWizard("Assign Management Type");

		// Create the first page of the wizard
		AbstractWizardPage forestPage = new ForestPage();

		// Create the controller for wizard
		WizardController wizardController = new WizardController(wizard);

		// Start the wizard and show it
		wizard.setVisible(true);
		wizardController.startWizard(forestPage);

		return landUseSubdivisions;
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


