package org.openforis.collect.earth.ipcc.view;

import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.util.ArrayList;
import java.util.List;

import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.CountryCode;
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandTypeEnum;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestTypeEnum;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;
import org.openforis.collect.earth.ipcc.model.OtherlandSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementTypeEnum;
import org.openforis.collect.earth.ipcc.model.WetlandSubdivision;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import se.gustavkarlsson.gwiz.AbstractWizardPage;
import se.gustavkarlsson.gwiz.WizardController;

public class AssignSubdivisionTypesWizard {

	JDialogWizard wizard ;
	CountryCode countryCode;
	private Logger logger = LoggerFactory.getLogger( AssignSubdivisionTypesWizard.class);
	private String regionAttribute;
	
	public void initializeTypes(List<AbstractLandUseSubdivision> landUseSubdivisions, List<String> attributeNames ) {

		LandUseSubdivisionUtils.setLandUseSubdivisions(landUseSubdivisions);
		
		// Create a new wizard (this one is based on a JFrame)
		wizard = new JDialogWizard(null, "Assign Management Type", true);
		
		wizard.addWindowListener( new WindowAdapter() {
			public void windowClosing(WindowEvent e) {
				if( !isWizardFinished() ) {
					try {
						SwingUtilities.invokeLater(
								() -> JOptionPane.showMessageDialog(wizard, 
										"You need to assign management types for all subdivisions and then click on \"Finish\" to proceed" , 
										"Closing without finishing assginment of subdivisions", JOptionPane.WARNING_MESSAGE)
						);
					} catch (Exception ex) {
						logger.error("Error showing message",ex);
					}
				}
			}
		});

		// Create the first page of the wizard
		AbstractWizardPage forestPage = new ForestPage();

		CountryPage countryPage = new CountryPage( forestPage, this, attributeNames );
		
		// Create the controller for wizard
		WizardController wizardController = new WizardController(wizard);

		// Start the wizard and show it
		wizardController.startWizard(countryPage);
		wizard.setVisible(true);

	}
	
	public boolean isWizardFinished() {
		return wizard.isWizardFinished();
	}

//	public static void main(String[] args) {
//
//		List<AbstractLandUseSubdivision> luses = new ArrayList();
//
//		Integer id  =1;
//		luses.add( new ForestSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("c", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("c", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("c", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("c", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//		luses.add( new ForestSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++, ForestTypeEnum.OTHER_CONIF )  );
//
//		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("c", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("c", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("c", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("a", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("c", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("b", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//		luses.add( new CroplandSubdivision("f", "aaaaa", CroplandTypeEnum.ANNUAL , id++ )  );
//
//		luses.add( new WetlandSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new WetlandSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new WetlandSubdivision("c", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new WetlandSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new WetlandSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new WetlandSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		
//		luses.add( new GrasslandSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new GrasslandSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new GrasslandSubdivision("c", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new GrasslandSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new GrasslandSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new GrasslandSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		
//		luses.add( new OtherlandSubdivision("a", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new OtherlandSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new OtherlandSubdivision("c", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new OtherlandSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new OtherlandSubdivision("b", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//		luses.add( new OtherlandSubdivision("f", "aaaaa", ManagementTypeEnum.MANAGED , id++ )  );
//
//		luses.add( new SettlementSubdivision("a", "aaaaa", SettlementTypeEnum.TREED , id++ )  );
//		luses.add( new SettlementSubdivision("b", "aaaaa", SettlementTypeEnum.TREED , id++ )  );
//		luses.add( new SettlementSubdivision("c", "aaaaa", SettlementTypeEnum.TREED , id++ )  );
//		luses.add( new SettlementSubdivision("f", "aaaaa", SettlementTypeEnum.TREED , id++ )  );
//		luses.add( new SettlementSubdivision("b", "aaaaa", SettlementTypeEnum.OTHER , id++ )  );
//		luses.add( new SettlementSubdivision("f", "aaaaa", SettlementTypeEnum.OTHER , id++ )  );
//		
//		AssignSubdivisionTypesWizard wizard = new AssignSubdivisionTypesWizard();
//
//		wizard.initializeTypes(luses);
//	}

	public void setCountryCode(CountryCode countryCode) {
		this.countryCode = countryCode;
	}

	public void setRegionAttribute(String regionAttribute) {
		this.regionAttribute = regionAttribute;
		
	}

	public CountryCode getCountryCode() {
		return countryCode;
	}

	public String getRegionAttribute() {
		return regionAttribute;
	}

}


