package org.openforis.collect.earth.app.service;

import org.openforis.collect.earth.ipcc.IPCCGenerator;
import org.openforis.collect.earth.ipcc.IPCCGeneratorException;
import org.openforis.collect.earth.ipcc.IPCCLandUses;
import org.openforis.collect.earth.ipcc.RdbExportException;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.view.DataFormat;
import org.openforis.collect.earth.app.view.FileChooserUtils;
import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.view.AssignSubdivisionTypesWizard;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
import org.openforis.idm.metamodel.NodeDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class IPCCGeneratorService extends GenerateDatabase{

	@Autowired
	RDBExporter rdbExporter;
	
	@Autowired
	CollectRDBPublisher collectRDBPublisher;

	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	public LocalPropertiesService localPropertiesService;

	@Autowired
	BrowserService browserService;

	@Autowired
	private IPCCGenerator ipccGenerator;
	
	@Autowired
	IPCCLandUses landUses;
	
	final Logger logger = LoggerFactory.getLogger(IPCCGeneratorService.class);

	/**
	 * The Swing entry (IPCCGeneratorListener): the database, then the wizard that assigns the management types and the
	 * dialog that asks for the ZIP, then the outputs, which are opened. The pages do the same in two jobs
	 * (AnalysisService.ipccPrepare and ipccOutputs), with a form between them.
	 */
	public void prepareDataForAnalysis(AnalysisProgress progressListener, boolean startSaikuAfterDBExport) throws RdbExportException {
		prepareDatabase(progressListener);
		progressListener.hide();
		try {
			List<String> attributeNames = new ArrayList<String>();
			earthSurveyService.getCollectSurvey().getSchema().getFirstRootEntityDefinition().getChildDefinitions()
					.forEach(nodeDefinition -> attributeNames.add(nodeDefinition.getName()));
			AssignSubdivisionTypesWizard wizard = new AssignSubdivisionTypesWizard();
			wizard.initializeTypes(getLandUseSubdivisions(), attributeNames);
			if (!wizard.isWizardFinished()) {
				logger.info("The user closed the wizard without finishing assigning management types");
				return;
			}
			File[] exportToFile = FileChooserUtils.getFileChooserResults(DataFormat.GHGI_ZIP_FILE, true, false, "LandUseForGHGi",
					localPropertiesService, null);
			if (exportToFile == null || exportToFile.length != 1) {
				logger.info("The user should choose a ZIP file to export the results to! No file chosen, aborting the rest of the execution");
				return;
			}
			progressListener.show();
			produceOutputs(wizard.getCountryCode().getCode(), wizard.getRegionAttribute(), exportToFile[0], progressListener);
			// Open the ZIP file automatically to inspect the output
			CollectEarthUtils.openFile(exportToFile[0]);
		} catch (Exception e) {
			logger.error("Error while generating GHGi tool file ", e); //$NON-NLS-1$
		}
	}

	/** The database the package is made from: generated when asked to refresh or when there is none, else restored. */
	public void prepareDatabase(AnalysisProgress progressListener) throws RdbExportException {
		try {
			landUses.initializeCodeListValues();
			if ((localPropertiesService.isUsingSqliteDB() && !getZippedProjectDB(ExportType.IPCC).exists()) || isRefreshDatabase()) {
				// The user clicked on the option to refresh the database, or there is no previous copy of the IPCC DB
				ipccGenerator.generateRDB(earthSurveyService.getCollectSurvey(), progressListener);
				try {
					// Save the DB file in a zipped file to keep for the next usages
					replaceZippedProjectDB(ExportType.IPCC);
				} catch (Exception e) {
					logger.error("Error while refreshing the Zipped content of the project IPCC DB", e);
				}
			} else if (getZippedProjectDB(ExportType.IPCC).exists() && localPropertiesService.isUsingSqliteDB()) {
				// The zipped version of the project exists (and the user chose not to refresh it): restore it
				restoreZippedProjectDB(ExportType.IPCC);
			}
		} catch (final CollectRdbException e) {
			logger.error("Error while producing Relational DB from Collect format", e); //$NON-NLS-1$
			throw new IPCCGeneratorException("Error while producing Relational DB from Collect format: " + e.getMessage());
		}
	}

	/** The land use subdivisions found in the data, which the form or the wizard assigns management types to. */
	public List<AbstractLandUseSubdivision> getLandUseSubdivisions() {
		List<AbstractLandUseSubdivision> subdivisions = landUses.getLandUseSubdivisions();
		LandUseSubdivisionUtils.setLandUseSubdivisions(subdivisions);
		return subdivisions;
	}

	/** The outputs into the ZIP, from the subdivisions as assigned. */
	public void produceOutputs(String countryCode, String regionAttribute, File destinationZip, AnalysisProgress progressListener)
			throws IOException, IPCCGeneratorException {
		ipccGenerator.produceOutputs(earthSurveyService.getCollectSurvey(), countryCode, regionAttribute, destinationZip, progressListener);
	}

	public static boolean surveyContains(String nodeName, CollectSurvey survey) {
		NodeDefinition nodeDefForNAme = survey.getSchema().findNodeDefinition( nodeDef -> nodeDef.getName().equals(nodeName) );
		return nodeDefForNAme != null;
	}


	@Override
	public LocalPropertiesService getLocalPropertiesService() {
		return localPropertiesService;
	}

	@Override
	public EarthSurveyService getEarthSurveyService() {
		return earthSurveyService;
	}

	@Override
	public RDBExporter getRdbExporter() {
		return rdbExporter;
	}

}