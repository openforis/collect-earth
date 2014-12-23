package org.openforis.collect.earth.app.service;

import java.io.File;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.io.data.CSVDataExportProcess;
import org.openforis.collect.io.data.CSVDataImportProcess;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.io.data.XMLDataExportProcess;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.RecordFilter;
import org.openforis.commons.collection.Predicate;
import org.openforis.idm.model.BooleanAttribute;
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

	@Autowired
	private SurveyManager surveyManager;

	@Autowired
	private RecordManager recordManager;

	private final Logger logger = LoggerFactory.getLogger(DataImportExportService.class);
	/**
	 * Use the application context to get a new bean everytime the data is exported ( as a new instance is needed every time)
	 */
	@Autowired
	private ApplicationContext applicationContext;

	private void addRecordsToImportList(CollectSurvey collectSurvey, List<DataImportSummaryItem> recordsToImport, List<Integer> entryIdsToImport) {
		if (recordsToImport != null) {
			List<DataImportSummaryItem> cleanRecordsToImport = recordsToImport;
			for (final DataImportSummaryItem importRecord : cleanRecordsToImport) {
				entryIdsToImport.add(importRecord.getEntryId());
			}
		}
	}

	public CSVDataExportProcess exportSurveyAsCsv(File exportToFile) throws Exception {
		final CSVDataExportProcess csvDataExportProcess = applicationContext.getBean(CSVDataExportProcess.class);
		csvDataExportProcess.setOutputFile(exportToFile);

		csvDataExportProcess.setEntityId(earthSurveyService.getCollectSurvey().getSchema().getRootEntityDefinition(EarthConstants.ROOT_ENTITY_NAME).getId());

		csvDataExportProcess.setIncludeAllAncestorAttributes(true);

		csvDataExportProcess.setRecordFilter( getRecordFilter() ) ;


		return csvDataExportProcess;
	}

	private RecordFilter getRecordFilter( ) {
		RecordFilter recordFilter = new RecordFilter(earthSurveyService.getCollectSurvey(), earthSurveyService.getCollectSurvey().getSchema().getRootEntityDefinition(EarthConstants.ROOT_ENTITY_NAME).getId());
		recordFilter.setStepGreaterOrEqual(Step.ENTRY);
		return recordFilter;
	}

	public CSVDataExportProcess exportSurveyAsFusionTable(File exportToFile) throws Exception {

		final CSVDataExportProcess csvDataExportProcess = applicationContext.getBean(CSVDataExportProcess.class);
		csvDataExportProcess.setOutputFile(exportToFile);
		csvDataExportProcess.setEntityId(earthSurveyService.getCollectSurvey().getSchema().getRootEntityDefinition(EarthConstants.ROOT_ENTITY_NAME).getId());
		csvDataExportProcess.setIncludeAllAncestorAttributes(true);
		csvDataExportProcess.setIncludeCodeItemPositionColumn(true);
		csvDataExportProcess.setIncludeKMLColumnForCoordinates(true);
		csvDataExportProcess.setRecordFilter( getRecordFilter() ) ;
		return csvDataExportProcess;
	}

	public XMLDataExportProcess exportSurveyAsZipWithXml(File exportToFile, Date modifiedSince) throws Exception {
		final XMLDataExportProcess xmlDataExportProcess = applicationContext.getBean(XMLDataExportProcess.class);
		xmlDataExportProcess.setOutputFile(exportToFile);
		xmlDataExportProcess.setRootEntityName(EarthConstants.ROOT_ENTITY_NAME);
		xmlDataExportProcess.setSurvey(earthSurveyService.getCollectSurvey());
		xmlDataExportProcess.setModifiedSince(modifiedSince);
		xmlDataExportProcess.setIncludeIdm(true);
		xmlDataExportProcess.setSteps(new Step[] { Step.ENTRY });
		return xmlDataExportProcess;
	}


	public CSVDataImportProcess getCsvImporterProcess(File importFromFile) throws Exception {
		final CSVDataImportProcess importProcess = applicationContext.getBean(CSVDataImportProcess.class);

		importProcess.setFile(importFromFile);
		importProcess.setSurvey(earthSurveyService.getCollectSurvey());
		importProcess.setParentEntityDefinitionId(earthSurveyService.getCollectSurvey().getSchema().getRootEntityDefinition(EarthConstants.ROOT_ENTITY_NAME).getId());
		importProcess.setStep(Step.ENTRY );
		importProcess.setRecordValidationEnabled(false);
		importProcess.setInsertNewRecords(false);
		importProcess.setNewRecordVersionName(null);
		return importProcess;
	}

	public XMLDataImportProcess getImportSummary(File zipWithXml, boolean importNonFinishedPlots) throws Exception {
		final XMLDataImportProcess dataImportProcess = applicationContext.getBean(XMLDataImportProcess.class);
		dataImportProcess.setFile(zipWithXml);
		dataImportProcess.prepareToStartSummaryCreation();

		if( !importNonFinishedPlots ){ // Import only plots whose actively_saved state is set to true
			dataImportProcess.setIncludeRecordPredicate( new Predicate<CollectRecord>() {

				@Override
				public boolean evaluate(CollectRecord record) {
					boolean include = true;

					try {
						final BooleanAttribute node = (BooleanAttribute) record.findNodeByPath("/plot/actively_saved");

						include = (node == null || (node != null && !node.isEmpty() && node.getValue().getValue()) );
					} catch (Exception e) {
						logger.error("No \"/plot/actively_saved\" node found ", e );
					}

					return include;
				}
			});
		}
		return dataImportProcess;
	}

	public void importRecordsFrom(File zipWithXml, XMLDataImportProcess dataImportProcess, List<DataImportSummaryItem> listConflictingRecords) throws Exception {
		final List<Integer> entryIdsToImport = new ArrayList<Integer>();

		addRecordsToImportList(dataImportProcess.getExistingSurvey(), listConflictingRecords, entryIdsToImport);
		addRecordsToImportList(dataImportProcess.getPackagedSurvey(), dataImportProcess.getSummary().getRecordsToImport(),entryIdsToImport);

		dataImportProcess.setEntryIdsToImport(entryIdsToImport);
		dataImportProcess.prepareToStartImport();
		dataImportProcess.call();

		int conflictingRecordsAdded = 0;
		if (listConflictingRecords != null) {
			conflictingRecordsAdded = listConflictingRecords.size();
		}

		logger.warn("Data imported into db. Number of Records imported : " + entryIdsToImport.size() + " Conflicting records added : "
				+ conflictingRecordsAdded);
	}


}
