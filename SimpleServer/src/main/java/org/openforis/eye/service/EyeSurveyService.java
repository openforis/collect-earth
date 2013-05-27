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
import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.collect.persistence.SurveyImportException;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.metamodel.xml.IdmlParseException;
import org.openforis.idm.model.Entity;
import org.springframework.beans.factory.annotation.Autowired;

public class EyeSurveyService {

	private static final String ROOT_ENTITY = "plot";

	private static final String EYE_SURVEY_NAME = "eye";

	@Autowired
	SurveyManager surveyManager;

	@Autowired
	RecordManager recordManager;

	@Autowired
	CollectParametersHandler collectParametersHandler;

	CollectSurvey collectSurvey;

	String idmFilePath;

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

	public Map<String,String> getPlacemark(String placemarkId) {
		List<CollectRecord> summaries = recordManager.loadSummaries(collectSurvey, ROOT_ENTITY, placemarkId);
		CollectRecord record = null;
		Map<String, String> placemarkParameters = null;
		if (summaries.size() > 0) {
			record = summaries.get(0);
			record = recordManager.load(collectSurvey, record.getId(), Step.ENTRY.getStepNumber());
			
			placemarkParameters = collectParametersHandler.getParameters(record.getRootEntity());

		}
		return placemarkParameters;
	}


	public void storePlacemark(Map<String, String> parameters, String sessionId) throws RecordPersistenceException {
		List<CollectRecord> summaries = recordManager
				.loadSummaries(collectSurvey, ROOT_ENTITY, parameters.get("collect_text_id"));

		CollectRecord record = null;
		if (summaries.size() > 0) { // DELETE IF ALREADY PRESENT
			record = summaries.get(0);
			recordManager.delete(record.getId());
		}

		// Create new record
		Schema schema = collectSurvey.getSchema();
		CollectRecord storeRecord = recordManager.create(collectSurvey, schema.getRootEntityDefinition(ROOT_ENTITY), null, null,
				sessionId);
		Entity plotEntity = storeRecord.getRootEntity();

		// Populate the data of the record using the HTTP parameters received
		collectParametersHandler.saveToEntity(parameters, plotEntity);

		recordManager.save(storeRecord, sessionId);
	}

}
