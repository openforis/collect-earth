package org.openforis.eye.service;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.util.List;
import java.util.Map;

import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectSurvey;
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

public class EyeSurveyService {

	private static final String COLLECT_TEXT_OPERATOR = "collect_text_operator";

	private static final String ROOT_ENTITY = "plot";

	private static final String EYE_SURVEY_NAME = "eye";

	private static final String SKIP_FILLED_PLOT_PARAMETER = "eye_skip_filled";

	@Autowired
	SurveyManager surveyManager;

	@Autowired
	RecordManager recordManager;

	@Autowired
	CollectParametersHandler collectParametersHandler;

	@Autowired
	LocalPropertiesService localPropertiesService;

	CollectSurvey collectSurvey;

	String idmFilePath;

	Logger logger = LoggerFactory.getLogger(this.getClass());

	public EyeSurveyService(String idmFilePath) {
		super();
		this.idmFilePath = idmFilePath;
	}

	private String getIdmFilePath() {
		return idmFilePath;
	}

	public void init() throws FileNotFoundException, IdmlParseException, SurveyImportException {
		collectSurvey = surveyManager.get(EYE_SURVEY_NAME);
		if (collectSurvey == null) {
			collectSurvey = surveyManager.unmarshalSurvey(new FileInputStream(new File(getIdmFilePath())));
			collectSurvey.setName(EYE_SURVEY_NAME);
			surveyManager.importModel(collectSurvey);
		}
	}

	public Map<String, String> getPlacemark(String placemarkId) {
		List<CollectRecord> summaries = recordManager.loadSummaries(collectSurvey, ROOT_ENTITY, placemarkId);
		CollectRecord record = null;
		Map<String, String> placemarkParameters = null;
		if (summaries.size() > 0) {
			record = summaries.get(0);
			record = recordManager.load(collectSurvey, record.getId(), Step.ENTRY.getStepNumber());
			placemarkParameters = collectParametersHandler.getParameters(record.getRootEntity());
		}

		// placemarkParameters.put(SKIP_FILLED_PLOT_PARAMETER,
		// localPropertiesService.shouldSkipFilledPlots() + "");
		
		return placemarkParameters;
	}

	public boolean storePlacemark(Map<String, String> parameters, String sessionId) {

		List<CollectRecord> summaries = recordManager.loadSummaries(collectSurvey, ROOT_ENTITY, parameters.get("collect_text_id"));

		boolean success = false;

		try {
			// Add the operator to the collected data
			parameters.put(COLLECT_TEXT_OPERATOR, localPropertiesService.getOperator());

			CollectRecord record = null;
			Entity plotEntity = null;

			if (summaries.size() > 0) { // DELETE IF ALREADY PRESENT
				record = summaries.get(0);
				plotEntity = record.createRootEntity(ROOT_ENTITY);
				logger.warn("Update a plot entity with data " + parameters.toString());
			} else {
				// Create new record
				Schema schema = collectSurvey.getSchema();
				record = recordManager.create(collectSurvey, schema.getRootEntityDefinition(ROOT_ENTITY), null, null, sessionId);
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
			// if (record.getErrors() == 0) {
				recordManager.save(record, sessionId);
				success = true;
			// }
		} catch (RecordPersistenceException e) {
			logger.error("Error while storing the record " + e.getMessage(), e);
		}

		return success;
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

				parameters.put("validation_" + node.getDefinition().getName(),
						label + " - " + recordValidationReportItem.getMessage());

			} else {
				label = recordValidationReportItem.getPath();
				parameters.put("validation_" + label, label + " - " + recordValidationReportItem.getMessage());
			}


		}

		if (validationItems.size() > 0) {
			parameters.put("valid_data", "false");
		}


	}

	private void saveLocalProperties(Map<String, String> parameters) {
		// Save extra information
		localPropertiesService.setSkipFilledPlots(parameters.get(SKIP_FILLED_PLOT_PARAMETER));
	}

	public boolean isPlacemarSavedActively(Map<String, String> parameters) {
		return parameters != null && parameters.get("collect_boolean_actively_saved") != null
				&& parameters.get("collect_boolean_actively_saved").equals("true");
	}

}
