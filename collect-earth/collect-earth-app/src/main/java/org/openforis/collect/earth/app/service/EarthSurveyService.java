package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Vector;

import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.manager.exception.SurveyValidationException;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.RecordSummarySortField;
import org.openforis.collect.model.RecordSummarySortField.Sortable;
import org.openforis.collect.model.RecordValidationReportGenerator;
import org.openforis.collect.model.RecordValidationReportItem;
import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.collect.persistence.SurveyImportException;
import org.openforis.idm.metamodel.NodeLabel.Type;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.metamodel.xml.IdmlParseException;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;

public class EarthSurveyService {

	private static final String COLLECT_BOOLEAN_ACTIVELY_SAVED = "collect_boolean_actively_saved";
	private static final String COLLECT_TEXT_OPERATOR = "collect_text_operator";
	private static final String EARTH_SURVEY_NAME = "earth";
	public static final String PLACEMARK_FOUND_PARAMETER = "placemark_found";
	public static final int ROOT_ENTITY_ID = 1;
	public static final String ROOT_ENTITY_NAME = "plot";
	private static final String SKIP_FILLED_PLOT_PARAMETER = "earth_skip_filled";

	@Autowired
	private CollectParametersHandlerService collectParametersHandler;

	private CollectSurvey collectSurvey;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	@Autowired
	private RecordManager recordManager;

	@Autowired
	private SurveyManager surveyManager;

	private void addLocalProperties(Map<String, String> placemarkParameters) {
		placemarkParameters.put(SKIP_FILLED_PLOT_PARAMETER, localPropertiesService.shouldSkipFilledPlots() + "");
	}

	private void addResultParameter(Map<String, String> placemarkParameters, boolean found) {
		placemarkParameters.put(PLACEMARK_FOUND_PARAMETER, found + "");
	}

	private void addValidationMessages(Map<String, String> parameters, CollectRecord record) {
		// Validation
		recordManager.validate(record);
		
		RecordValidationReportGenerator reportGenerator = new RecordValidationReportGenerator(record);
		List<RecordValidationReportItem> validationItems = reportGenerator.generateValidationItems();
		
		for (RecordValidationReportItem recordValidationReportItem : validationItems) {
			String label = "";
			if (recordValidationReportItem.getNodeId() != null) {
				Node<?> node = record.getNodeByInternalId(recordValidationReportItem.getNodeId());
				label = node.getDefinition().getLabel(Type.INSTANCE, "en");

				String message = recordValidationReportItem.getMessage();
				if (message.equals("Reason blank not specified")) {
					message = "Field required";
				}

				parameters.put("validation_" + node.getDefinition().getName(), label + " - " + message);

			} else {
				label = recordValidationReportItem.getPath();
				parameters.put("validation_" + label, label + " - " + recordValidationReportItem.getMessage());
			}

		}

		if (validationItems.size() > 0) {
			parameters.put("valid_data", "false");
		}

	}

	private CollectRecord createRecord(String sessionId) throws RecordPersistenceException {
		Schema schema = getCollectSurvey().getSchema();
		CollectRecord record = recordManager.create(getCollectSurvey(), schema.getRootEntityDefinition(ROOT_ENTITY_NAME), null, null, sessionId);
		return record;
	}

	public List<String> getAllFilledPlacemarkIds() {
		List<CollectRecord> summaries = recordManager.loadSummaries(getCollectSurvey(), ROOT_ENTITY_NAME);
		List<String> ids = new Vector<String>();
		for (CollectRecord record : summaries) {
			CollectRecord recordloaded = recordManager.load(getCollectSurvey(), record.getId(), Step.ENTRY);
			List<String> keys = recordloaded.getRootEntityKeyValues();
			for (String key : keys) {
				ids.add(key);
			}
		}
		return ids;
	}

	CollectSurvey getCollectSurvey() {
		return collectSurvey;
	}

	private String getIdmFilePath() {
		return localPropertiesService.getValue(LocalPropertiesService.METADATA_FILE);
	}

	public Map<String, String> getPlacemark(String placemarkId) {
		List<CollectRecord> summaries = recordManager.loadSummaries(getCollectSurvey(), ROOT_ENTITY_NAME, placemarkId);
		CollectRecord record = null;
		Map<String, String> placemarkParameters = null;
		if (summaries.size() > 0) {
			record = summaries.get(0);
			record = recordManager.load(getCollectSurvey(), record.getId(), Step.ENTRY);
			placemarkParameters = collectParametersHandler.getParameters(record.getRootEntity());

			if (placemarkParameters.get("collect_code_crown_cover") != null
					&& placemarkParameters.get("collect_code_crown_cover").equals("0")) {
				placemarkParameters.put("collect_code_crown_cover",
						"0;collect_code_deforestation_reason=" + placemarkParameters.get("collect_code_deforestation_reason"));
			}

			addResultParameter(placemarkParameters, true);
		} else {
			placemarkParameters = new HashMap<String, String>();
			addResultParameter(placemarkParameters, false);
		}

		addLocalProperties(placemarkParameters);

		return placemarkParameters;
	}

	public List<CollectRecord> getRecordsSavedSince(Date updatedSince) {
		List<CollectRecord> summaries = recordManager.loadSummaries(getCollectSurvey(), ROOT_ENTITY_NAME, 0, 15,
				Arrays.asList(new RecordSummarySortField(Sortable.DATE_MODIFIED, true)), (String[]) null);
		if (updatedSince != null && summaries != null && !summaries.isEmpty()) {
			List<CollectRecord> records = new ArrayList<CollectRecord>();
			for (int i = 0; i < summaries.size(); i++) {
				CollectRecord summary = summaries.get(i);
				CollectRecord record = recordManager.load(getCollectSurvey(), summary.getId(), Step.ENTRY);

				if (record.getModifiedDate() != null && record.getModifiedDate().after(updatedSince)) {
					records.add(record);
				}

				if (record.getModifiedDate() != null && record.getModifiedDate().before(updatedSince)) {
					break;
				}
			}
			return records;
		} else {
			return null;
		}
	}

	public void init() throws FileNotFoundException, IdmlParseException, SurveyImportException {
		// Initilize the Collect survey using the idm
		// This is only done if the survey has not yet been created in the DB

		// setCollectSurvey(surveyManager.get(EARTH_SURVEY_NAME));
		if (getCollectSurvey() == null) {
			CollectSurvey survey;
			try {
				survey = surveyManager.unmarshalSurvey(new FileInputStream(new File(getIdmFilePath())));

				survey.setName(EARTH_SURVEY_NAME);
				if (surveyManager.get(EARTH_SURVEY_NAME) == null) { // NOT IN
																	// THE DB
					surveyManager.importModel(survey);
				} else { // UPDATE ALREADY EXISTANT MODEL
					surveyManager.updateModel(survey);
				}
				setCollectSurvey(survey);
			} catch (SurveyValidationException e) {
				logger.error("Unable to validate survey at " + getIdmFilePath(), e);
			}
		}
	}

	public boolean isPlacemarSavedActively(Map<String, String> parameters) {
		return parameters != null && parameters.get(COLLECT_BOOLEAN_ACTIVELY_SAVED) != null
				&& parameters.get(COLLECT_BOOLEAN_ACTIVELY_SAVED).equals("true");
	}

	private void saveLocalProperties(Map<String, String> parameters) {
		// Save extra information
		localPropertiesService.setSkipFilledPlots(parameters.get(SKIP_FILLED_PLOT_PARAMETER));
	}

	void setCollectSurvey(CollectSurvey collectSurvey) {
		this.collectSurvey = collectSurvey;
	}

	public void setPlacemarSavedActively(Map<String, String> parameters, boolean value) {
		parameters.put(COLLECT_BOOLEAN_ACTIVELY_SAVED, value + "");
	}

	public boolean storePlacemark(Map<String, String> parameters, String sessionId) {

		List<CollectRecord> summaries = recordManager.loadSummaries(getCollectSurvey(), ROOT_ENTITY_NAME,
				parameters.get("collect_text_id"));

		boolean success = false;

		try {
			// Add the operator to the collected data
			parameters.put(COLLECT_TEXT_OPERATOR, localPropertiesService.getOperator());

			CollectRecord record = null;
			Entity plotEntity = null;

			if (summaries.size() > 0) { // DELETE IF ALREADY PRESENT
				record = summaries.get(0);
				recordManager.delete(record.getId());
				// plotEntity = record.createRootEntity(ROOT_ENTITY_NAME);
				// logger.warn("Update a plot entity with data " +
				// parameters.toString());

				// STILL NOT WORKING VERY WELL TO UPDATE SO LETS REMO=VE AND
				// CREATER A NEW ENTITY
				record = createRecord(sessionId);
				plotEntity = record.getRootEntity();

			} else {
				// Create new record
				record = createRecord(sessionId);
				plotEntity = record.getRootEntity();
				logger.warn("Creating a new plot entity with data " + parameters.toString());
			}

			// Populate the data of the record using the HTTP parameters
			// received
			collectParametersHandler.saveToEntity(parameters, plotEntity);

			saveLocalProperties(parameters);

			// Do not validate unless actively saved
			if (isPlacemarSavedActively(parameters)) {
				addValidationMessages(parameters, record);
			}

			// Do not save unless there is no validation errors
			if (record.getErrors() == 0 && record.getSkipped() == 0) {
				record.setModifiedDate(new Date());
				recordManager.save(record, sessionId);
				success = true;
			} else {
				// Save the data anyway but set the Actively Saved flag to false
				setPlacemarSavedActively(parameters, false);
				return storePlacemark(parameters, sessionId);

			}
		} catch (RecordPersistenceException e) {
			logger.error("Error while storing the record " + e.getMessage(), e);
		}

		return success;
	}

}
