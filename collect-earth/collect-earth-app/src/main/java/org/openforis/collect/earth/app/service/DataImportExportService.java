package org.openforis.collect.earth.app.service;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.io.data.CSVDataExportProcess;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.io.data.XMLDataExportProcess;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.openforis.collect.model.CollectRecord.Step;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class DataImportExportService {

	@Autowired
	private EarthSurveyService earthSurveyService;

	private Logger logger = LoggerFactory.getLogger( DataImportExportService.class );
	/**
	 * Use the application context to get a new bean everytime the data is exported ( as a new instance is needed every time)
	 */
	@Autowired
	private ApplicationContext applicationContext;
	

	public void exportSurveyAsZipWithXml(File exportToFile) throws  Exception {	
		XMLDataExportProcess xmlDataExportProcess = applicationContext.getBean( XMLDataExportProcess.class );
		xmlDataExportProcess.setOutputFile(exportToFile);
		xmlDataExportProcess.setRootEntityName(EarthConstants.ROOT_ENTITY_NAME);
		xmlDataExportProcess.setSurvey(earthSurveyService.getCollectSurvey());
		xmlDataExportProcess.setIncludeIdm(true);
		xmlDataExportProcess.setSteps(new Step[]{Step.ENTRY});
		xmlDataExportProcess.startProcessing();
	}
	
	public void exportSurveyAsCsv(File exportToFile) throws  Exception {
		CSVDataExportProcess csvDataExportProcess = applicationContext.getBean( CSVDataExportProcess.class );
		csvDataExportProcess.setOutputFile(exportToFile);
		csvDataExportProcess.setRootEntityName(EarthConstants.ROOT_ENTITY_NAME);
		csvDataExportProcess.setEntityId( earthSurveyService.getCollectSurvey().getSchema().getRootEntityDefinition( EarthConstants.ROOT_ENTITY_NAME ).getId() );
		csvDataExportProcess.setSurvey(earthSurveyService.getCollectSurvey());
		csvDataExportProcess.setStep(Step.ENTRY);
		csvDataExportProcess.setIncludeAllAncestorAttributes(true);
		csvDataExportProcess.startProcessing();
	}

	public void exportSurveyAsFusionTable(File exportToFile) throws Exception {
		
		CSVDataExportProcess csvDataExportProcess = applicationContext.getBean( CSVDataExportProcess.class );
		csvDataExportProcess.setOutputFile(exportToFile);
		csvDataExportProcess.setRootEntityName(EarthConstants.ROOT_ENTITY_NAME);
		csvDataExportProcess.setEntityId( earthSurveyService.getCollectSurvey().getSchema().getRootEntityDefinition( EarthConstants.ROOT_ENTITY_NAME ).getId() );
		csvDataExportProcess.setSurvey(earthSurveyService.getCollectSurvey());
		csvDataExportProcess.setStep(Step.ENTRY);
		csvDataExportProcess.setIncludeAllAncestorAttributes(true);
		csvDataExportProcess.setIncludeCodeItemPositionColumn(true);
		csvDataExportProcess.setIncludeKMLColumnForCoordinates(true);
		csvDataExportProcess.startProcessing();
		
	}

	
	public XMLDataImportProcess getImportSummary(File zipWithXml ) throws Exception{
		XMLDataImportProcess dataImportProcess = applicationContext.getBean( XMLDataImportProcess.class );
		dataImportProcess.setFile(zipWithXml);
		dataImportProcess.prepareToStartSummaryCreation();
		dataImportProcess.call();
		return dataImportProcess;
	}
	
	public void importRecordsFrom( File zipWithXml , XMLDataImportProcess dataImportProcess, boolean addConflictingRecords ) throws Exception{
		List<Integer> entryIdsToImport = new ArrayList<Integer>();
		
		if( addConflictingRecords && dataImportProcess.getSummary().getRecordsToImport()!=null ){
			for (DataImportSummaryItem record : dataImportProcess.getSummary().getRecordsToImport()) {
				entryIdsToImport.add( record.getEntryId() );
			}
		}

		if( dataImportProcess.getSummary().getRecordsToImport() != null ){
			for (DataImportSummaryItem record : dataImportProcess.getSummary().getRecordsToImport()) {
				entryIdsToImport.add( record.getEntryId() );
			}
		}
		
		dataImportProcess.setEntryIdsToImport(entryIdsToImport);
		dataImportProcess.prepareToStartImport();
		dataImportProcess.call();
		logger.warn("Data imported into db. Number of Records imported : " + entryIdsToImport.size() + " Conflicting records added : " + addConflictingRecords );
	}

}
