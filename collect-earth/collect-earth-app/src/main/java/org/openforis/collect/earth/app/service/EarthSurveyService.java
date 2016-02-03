package org.openforis.collect.earth.app.service;

import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_ATTRIBUTE_NAME;
import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_ON_ATTRIBUTE_NAME;
import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_ON_PARAMETER;
import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_ON_PARAMETER_OLD;
import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_PARAMETER;
import static org.openforis.collect.earth.app.EarthConstants.COLLECT_REASON_BLANK_NOT_SPECIFIED_MESSAGE;
import static org.openforis.collect.earth.app.EarthConstants.EARTH_SURVEY_NAME;
import static org.openforis.collect.earth.app.EarthConstants.OPERATOR_PARAMETER;
import static org.openforis.collect.earth.app.EarthConstants.PLACEMARK_FOUND_PARAMETER;
import static org.openforis.collect.earth.app.EarthConstants.ROOT_ENTITY_NAME;
import static org.openforis.collect.earth.app.EarthConstants.SKIP_FILLED_PLOT_PARAMETER;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;

import javax.annotation.PostConstruct;
import javax.swing.JOptionPane;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.handlers.BalloonInputFieldsUtils;
import org.openforis.collect.earth.core.handlers.DateAttributeHandler;
import org.openforis.collect.earth.core.model.PlacemarkInputFieldInfo;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.manager.exception.SurveyValidationException;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.collect.model.RecordValidationReportGenerator;
import org.openforis.collect.model.RecordValidationReportItem;
import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.collect.persistence.SurveyImportException;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.ModelVersion;
import org.openforis.idm.metamodel.NodeLabel.Type;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.metamodel.xml.IdmlParseException;
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.BooleanAttribute;
import org.openforis.idm.model.BooleanValue;
import org.openforis.idm.model.DateAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.Node;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.TextValue;
import org.openforis.idm.model.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class EarthSurveyService {

	private CollectSurvey collectSurvey;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	@Autowired
	private RecordManager recordManager;

	@Autowired
	private SurveyManager surveyManager;

	private RecordUpdater recordUpdater;
	private BalloonInputFieldsUtils collectParametersHandler;

	public EarthSurveyService() {
		collectParametersHandler = new BalloonInputFieldsUtils();
		recordUpdater = new RecordUpdater();
		recordUpdater.setClearNotRelevantAttributes(true);
	}

	private void addLocalProperties(Map<String, String> placemarkParameters) {
		placemarkParameters.put(SKIP_FILLED_PLOT_PARAMETER,
				Boolean.toString(localPropertiesService.shouldJumpToNextPlot())); // $NON-NLS-1$
	}

	private void addResultParameter(Map<String, String> placemarkParameters, boolean found) {
		placemarkParameters.put(PLACEMARK_FOUND_PARAMETER, Boolean.toString(found)); // $NON-NLS-1$
	}

	@Deprecated
	private void addValidationMessages(Map<String, String> parameters, CollectRecord record) {
		// Validation
		recordUpdater.validate(record);

		final RecordValidationReportGenerator reportGenerator = new RecordValidationReportGenerator(record);
		final List<RecordValidationReportItem> validationItems = reportGenerator.generateValidationItems();

		for (final RecordValidationReportItem recordValidationReportItem : validationItems) {
			String label = ""; //$NON-NLS-1$
			if (recordValidationReportItem.getNodeId() != null) {
				final Node<?> node = record.getNodeByInternalId(recordValidationReportItem.getNodeId());
				label = node.getDefinition().getLabel(Type.INSTANCE,
						localPropertiesService.getUiLanguage().name().toLowerCase());

				String message = recordValidationReportItem.getMessage();
				if (message.equals(COLLECT_REASON_BLANK_NOT_SPECIFIED_MESSAGE)) { // $NON-NLS-1$
					message = Messages.getString("EarthSurveyService.9"); //$NON-NLS-1$
				}

				parameters.put("validation_" + node.getDefinition().getName(), label + " - " + message); //$NON-NLS-1$ //$NON-NLS-2$

			} else {
				label = recordValidationReportItem.getPath();
				parameters.put("validation_" + label, label + " - " + recordValidationReportItem.getMessage()); //$NON-NLS-1$ //$NON-NLS-2$
			}

		}

		if (validationItems.size() > 0) {
			parameters.put("valid_data", "false"); //$NON-NLS-1$ //$NON-NLS-2$
		}

	}

	protected String getAdaptedValidationMessage(String validationMessage) {
		String message;
		if (validationMessage.equals(COLLECT_REASON_BLANK_NOT_SPECIFIED_MESSAGE)) { // $NON-NLS-1$
			message = Messages.getString("EarthSurveyService.9"); //$NON-NLS-1$
		} else {
			message = validationMessage;
		}
		return message;
	}

	private CollectRecord createRecord(String sessionId) throws RecordPersistenceException {
		Schema schema = getCollectSurvey().getSchema();
		String modelVersionName = localPropertiesService.getModelVersionName();
		CollectRecord record = recordManager.create(getCollectSurvey(),
				schema.getRootEntityDefinition(ROOT_ENTITY_NAME), null, modelVersionName, sessionId);
		return record;
	}

	public CollectSurvey getCollectSurvey() {
		return collectSurvey;
	}

	private String getIdmFilePath() {
		return localPropertiesService.getImdFile();
	}

	public Map<String, String> getPlacemark(String[] keyAttributes, boolean validateRecord) {
		CollectRecord record = loadRecord(keyAttributes, validateRecord);
		Map<String, String> placemarkParameters = null;
		if (record == null) {
			placemarkParameters = new HashMap<String, String>();
			addResultParameter(placemarkParameters, false);
		} else {
			placemarkParameters = collectParametersHandler.getValuesByHtmlParameters(record.getRootEntity());

			if ((placemarkParameters.get("collect_code_canopy_cover") != null) //$NON-NLS-1$
					&& placemarkParameters.get("collect_code_canopy_cover").equals("0")) { //$NON-NLS-1$ //$NON-NLS-2$
				placemarkParameters.put("collect_code_canopy_cover", //$NON-NLS-1$
						"0;collect_code_deforestation_reason=" //$NON-NLS-1$
								+ placemarkParameters.get("collect_code_deforestation_reason")); //$NON-NLS-1$
			}
			// For the PNG version with the old name
			if ((placemarkParameters.get("collect_code_crown_cover") != null) //$NON-NLS-1$
					&& placemarkParameters.get("collect_code_crown_cover").equals("0")) { //$NON-NLS-1$ //$NON-NLS-2$
				placemarkParameters.put("collect_code_crown_cover", //$NON-NLS-1$
						"0;collect_code_deforestation_reason=" //$NON-NLS-1$
								+ placemarkParameters.get("collect_code_deforestation_reason")); //$NON-NLS-1$
			}
			addResultParameter(placemarkParameters, true);
		}
		addLocalProperties(placemarkParameters);

		return placemarkParameters;
	}

	public PlacemarkLoadResult loadPlacemarkExpanded(String[] multipleKeyAttributes) {
		PlacemarkLoadResult result;
		CollectRecord record = loadRecord(multipleKeyAttributes);
		if (record == null) {
			result = new PlacemarkLoadResult();
			result.setSuccess(false);
			result.setMessage("No placemark found");
		} else {
			result = createPlacemarkLoadSuccessResult(record);
		}
		return result;
	}

	public CollectRecord loadRecord(String[] mulitpleKeyAttributes) {
		return loadRecord(mulitpleKeyAttributes, true);
	}

	public synchronized CollectRecord loadRecord(String[] mulitpleKeyAttributes, boolean validateRecord) {
		List<CollectRecord> summaries = recordManager.loadSummaries(getCollectSurvey(), ROOT_ENTITY_NAME,
				mulitpleKeyAttributes);
		CollectRecord record = null;
		if (summaries.isEmpty()) {
			return null;
		} else {
			record = summaries.get(0);
			record = recordManager.load(getCollectSurvey(), record.getId(), Step.ENTRY, validateRecord);
			return record;
		}
	}

	/**
	 * Return a list of the Collect records that have been updated since the
	 * time passed as an argument. This method is useful to update the status of
	 * the placemarks ( updating the icon on the KML using a NetworkLink )
	 * 
	 * @param updatedSince
	 *            The date from which we want to find out if there were any
	 *            records that were updates/added
	 * @return The list of record that have been updated since the time stated
	 *         in updatedSince
	 */
	public List<CollectRecord> getRecordSummariesSavedSince(Date updatedSince) {
		List<CollectRecord> summaries = recordManager.loadSummaries(getCollectSurvey(), ROOT_ENTITY_NAME, updatedSince);
		return summaries;
	}

	public String[] getPlacemarksId(List<CollectRecord> listOfRecords) {
		if (listOfRecords == null) {
			return new String[0];
		}
		final String[] placemarkIds = new String[listOfRecords.size()];
		for (int i = 0; i < listOfRecords.size(); i++) {
			CollectRecord recordSummary = listOfRecords.get(i);
			List<String> rootEntityKeyValues = recordSummary.getRootEntityKeyValues();
			String keyValues = "";
			for (String key : rootEntityKeyValues) {
				keyValues += key + ",";
			}
			keyValues = keyValues.substring(0, keyValues.lastIndexOf(','));

			placemarkIds[i] = keyValues;
		}

		return placemarkIds;
	}

	/**
	 * Return the list of the IDs of records that are already saved (completely
	 * or partially) in the database.
	 * 
	 * @return The list of the IDs of the records for the survey in the DB
	 */
	public String[] getRecordsSavedIDs() {
		final List<CollectRecord> recordsSavedForSurvey = recordManager.loadSummaries(getCollectSurvey(),
				ROOT_ENTITY_NAME);

		if ((recordsSavedForSurvey != null) && !recordsSavedForSurvey.isEmpty()) {
			return getPlacemarksId(recordsSavedForSurvey);
		} else {
			return null;
		}
	}

	@PostConstruct
	private void init() throws FileNotFoundException, IdmlParseException, SurveyImportException {
		// Initialize the Collect survey using the idm
		// This is only done if the survey has not yet been created in the DB

		if (getCollectSurvey() == null) {
			CollectSurvey survey;
			try {
				File idmSurveyModel = new File(getIdmFilePath());
				if (idmSurveyModel.exists()) {
					survey = surveyManager.unmarshalSurvey(new FileInputStream(idmSurveyModel), true, true);
					if (surveyManager.getByUri(survey.getUri()) == null) { // NOT
																			// IN
						// THE DB
						String surveyName = EARTH_SURVEY_NAME
								+ localPropertiesService.getValue(EarthProperty.SURVEY_NAME);
						survey = surveyManager.importModel(idmSurveyModel, surveyName, false, true);

					} else { // UPDATE ALREADY EXISTANT MODEL
						survey = surveyManager.updateModel(idmSurveyModel, false, true);
					}

					checkVersions(survey);

					setCollectSurvey(survey);
				} else {
					logger.error(
							"The survey definition file could not be found in " + idmSurveyModel.getAbsolutePath()); //$NON-NLS-1$
				}
			} catch (final SurveyValidationException e) {
				logger.error("Unable to validate survey at " + getIdmFilePath(), e); //$NON-NLS-1$
				e.printStackTrace();
			}
		}

	}

	private void checkVersions(CollectSurvey loadedCollectSurvey) {

		if (!loadedCollectSurvey.getVersions().isEmpty()) {
			if (loadedCollectSurvey.getVersions().size() == 1) {
				ModelVersion onlyModelVersion = loadedCollectSurvey.getVersions().get(0);
				localPropertiesService.setModelVersionName(onlyModelVersion.getName());
			}

			/*
			 * The model version name comes directly from the CEP file ( initial
			 * earth properties )
			 */
			else {

				// Choose one of the versions
				ModelVersion chosenVersion = (ModelVersion) JOptionPane.showInputDialog(null,
						"Choose one survey version to work with", "Choose version", JOptionPane.QUESTION_MESSAGE, null,
						loadedCollectSurvey.getVersions().toArray(),
						loadedCollectSurvey.getVersions().get(loadedCollectSurvey.getVersions().size() - 1));
				localPropertiesService.setModelVersionName(chosenVersion.getName());

			}
		}
	}

	public boolean isPlacemarkEdited(Map<String, String> parameters) {
		return parameters != null && "false".equals(parameters.get(ACTIVELY_SAVED_PARAMETER)); //$NON-NLS-1$
	}

	public boolean isPlacemarkSavedActively(Map<String, String> parameters) {
		return parameters != null && "true".equals(parameters.get(ACTIVELY_SAVED_PARAMETER)); //$NON-NLS-1$
	}

	private void setCollectSurvey(CollectSurvey collectSurvey) {
		this.collectSurvey = collectSurvey;
	}

	private void setPlacemarkSavedOn(CollectRecord record) {
		String path = ROOT_ENTITY_NAME + "/" + ACTIVELY_SAVED_ON_ATTRIBUTE_NAME;
		Attribute<?, ?> attr = record.findNodeByPath(path);
		if (attr == null) {
			logger.warn("The expected attribute at " + path + " could not be found!");
		} else {
			if (attr instanceof DateAttribute) {
				org.openforis.idm.model.Date date = org.openforis.idm.model.Date.parse(new Date());
				recordUpdater.updateAttribute((DateAttribute) attr, date);
			} else if (attr instanceof TextAttribute) {
				SimpleDateFormat sdf = new SimpleDateFormat("yyyy/MM/dd hh:mm");
				org.openforis.idm.model.Date date = org.openforis.idm.model.Date.parse(new Date());
				recordUpdater.updateAttribute((TextAttribute) attr, new TextValue(sdf.format(date)));
			} else {
				logger.error("Attribute " + path + " is expected to be of type Text or Date");
			}
		}
	}

	private void setPlacemarkSavedActively(CollectRecord record, boolean value) {
		BooleanAttribute attr = record.findNodeByPath(ROOT_ENTITY_NAME + "/" + ACTIVELY_SAVED_ATTRIBUTE_NAME);
		recordUpdater.updateAttribute(attr, new BooleanValue(value));
	}

	private void setPlacemarkSavedOn(Map<String, String> parameters) {
		String dateSaved = DateAttributeHandler.DATE_ATTRIBUTE_FORMAT.format(new Date());
		parameters.put(ACTIVELY_SAVED_ON_PARAMETER, dateSaved);
		parameters.put(ACTIVELY_SAVED_ON_PARAMETER_OLD, dateSaved);

	}

	private void setPlacemarkSavedActively(Map<String, String> parameters, boolean value) {
		parameters.put(ACTIVELY_SAVED_PARAMETER, Boolean.toString(value)); // $NON-NLS-1$

	}

	@Deprecated
	public synchronized boolean storePlacemarkOld(Map<String, String> parameters, String sessionId) {

		String[] keys = new String[] { parameters.get(EarthConstants.PLACEMARK_ID_PARAMETER) };

		final List<CollectRecord> summaries = recordManager.loadSummaries(getCollectSurvey(), ROOT_ENTITY_NAME, keys); // $NON-NLS-1$
		boolean success = false;

		try {
			// Add the operator to the collected data
			parameters.put(OPERATOR_PARAMETER, localPropertiesService.getOperator());

			CollectRecord record = null;
			Entity plotEntity = null;

			if (summaries.size() > 0) { // DELETE IF ALREADY PRESENT
				record = summaries.get(0);
				recordManager.delete(record.getId());
				record = createRecord(sessionId);
				plotEntity = record.getRootEntity();
			} else {
				// Create new record
				record = createRecord(sessionId);
				plotEntity = record.getRootEntity();
				logger.warn("Creating a new plot entity with data " + parameters.toString()); //$NON-NLS-1$
			}

			boolean userClickOnSaveAndValidate = isPlacemarkSavedActively(parameters);

			setPlacemarkSavedOn(parameters);

			// Populate the data of the record using the HTTP parameters
			// received
			// This also generates the validation messages
			collectParametersHandler.saveToEntity(parameters, plotEntity);

			// Do not validate unless actively saved
			if (userClickOnSaveAndValidate) {
				addValidationMessages(parameters, record);

				// Check that there is no validation errors so the tick doesn't
				// turn green
				if (record.getSkipped() != 0 || record.getErrors() != 0) {
					setPlacemarkSavedActively(parameters, false);
					// Force saving again to remove the "actively saved"
					// parameter!
					collectParametersHandler.saveToEntity(parameters, plotEntity);

				}
			}

			record.setModifiedDate(new Date());
			recordManager.save(record, sessionId);

			success = true;
		} catch (final RecordPersistenceException e) {
			logger.error("Error while storing the record " + e.getMessage(), e); //$NON-NLS-1$
		}
		return success;
	}

	public synchronized PlacemarkLoadResult updatePlacemarkData(String[] plotKeyAttributes,
			Map<String, String> parameters, String sessionId, boolean partialUpdate) {
		try {
			// Add the operator to the collected data
			parameters.put(OPERATOR_PARAMETER, localPropertiesService.getOperator());

			// Populate the data of the record using the HTTP parameters
			// received
			CollectRecord record = loadRecord(plotKeyAttributes);
			if (record == null) {
				record = createRecord(null);
				// update actively_saved_on attribute now, otherwise if it's empty
				// it counts as an error
				setPlacemarkSavedOn(record);
				updateKeyAttributeValues(record, plotKeyAttributes);
				record.setModifiedDate(new Date());
				recordManager.save(record, sessionId);
				return createPlacemarkLoadSuccessResult(record);
			} else {
				Entity plotEntity = record.getRootEntity();
				
				Map<String, String> oldPlacemarkParameters = collectParametersHandler
						.getValuesByHtmlParameters(record.getRootEntity());
				Map<String, String> changedParameters = calculateChanges(oldPlacemarkParameters, parameters);
				
				boolean placemarkAlreadySavedActively = isPlacemarkSavedActively(oldPlacemarkParameters);
				boolean userClickOnSubmitAndValidate = isPlacemarkSavedActively(parameters);
				
				NodeChangeSet changeSet = collectParametersHandler.saveToEntity(changedParameters, plotEntity);
				
				// update actively_saved_on attribute now, otherwise if it's empty
				// it counts as an error
				setPlacemarkSavedOn(record);
				
				boolean noErrors = record.getErrors() == 0 && record.getSkipped() == 0;
				
				if (userClickOnSubmitAndValidate && !noErrors) {
					// if the user clicks on submit and validate but the data is not
					// valid,
					// do not save the record as actively saved
					setPlacemarkSavedActively(record, false);
				}
				
				if (!placemarkAlreadySavedActively || noErrors) {
					// only save data if the information is completely valid or if
					// the record is not already completely saved (green)
					record.setModifiedDate(new Date());
					recordManager.save(record, sessionId);
				}
				if (partialUpdate) {
					return createPlacemarkLoadSuccessResult(record, changeSet);
				} else {
					return createPlacemarkLoadSuccessResult(record);
				}
			}
		} catch (Exception e) {
			logger.error("Error while storing the record " + e.getMessage(), e); //$NON-NLS-1$
			PlacemarkLoadResult result = new PlacemarkLoadResult();
			result.setSuccess(false);
			return result;
		}
	}

	private PlacemarkLoadResult createPlacemarkLoadSuccessResult(CollectRecord record) {
		return createPlacemarkLoadSuccessResult(record, null);
	}

	private PlacemarkLoadResult createPlacemarkLoadSuccessResult(CollectRecord record, NodeChangeSet changeSet) {
		PlacemarkLoadResult result = new PlacemarkLoadResult();
		result.setSuccess(true);
		result.setCollectRecord(record);
		result.setSkipFilled(localPropertiesService.shouldJumpToNextPlot());
		Map<String, PlacemarkInputFieldInfo> infoByParameterName = collectParametersHandler
				.extractFieldInfoByParameterName(record, changeSet,
						localPropertiesService.getUiLanguage().getLocale().getLanguage(),
						localPropertiesService.getModelVersionName());
		// adjust error messages
		for (Entry<String, PlacemarkInputFieldInfo> entry : infoByParameterName.entrySet()) {
			PlacemarkInputFieldInfo info = entry.getValue();
			if (info.isInError()) {
				String message = info.getErrorMessage();
				if (message.equals(COLLECT_REASON_BLANK_NOT_SPECIFIED_MESSAGE)) { // $NON-NLS-1$
					info.setErrorMessage(Messages.getString("EarthSurveyService.9")); //$NON-NLS-1$
				}
			}
		}
		result.setInputFieldInfoByParameterName(infoByParameterName);
		return result;
	}

	private void updateKeyAttributeValues(CollectRecord record, String[] keyAttributeValues) {
		List<AttributeDefinition> keyAttributeDefinitions = getCollectSurvey().getSchema().getRootEntityDefinitions()
				.get(0).getKeyAttributeDefinitions();
		for (int i = 0; i < keyAttributeValues.length; i++) {
			String keyValue = keyAttributeValues[i];
			AttributeDefinition keyAttrDef = keyAttributeDefinitions.get(i);
			Attribute<?, Value> keyAttr = record.findNodeByPath(keyAttrDef.getPath());
			recordUpdater.updateAttribute(keyAttr, (Value) keyAttr.getDefinition().createValue(keyValue));
		}
	}

	private Map<String, String> calculateChanges(Map<String, String> oldPlacemarkParameters,
			Map<String, String> parameters) {
		Map<String, String> changedParameters = new HashMap<>(parameters.size());
		for (Entry<String, String> entry : parameters.entrySet()) {
			String param = entry.getKey();
			String newValue = entry.getValue();
			String oldValue = oldPlacemarkParameters.get(param);
			if ((oldValue == null && newValue != null && newValue.length() > 0)
					|| (oldValue != null && !oldValue.equals(newValue))) {
				changedParameters.put(param, newValue);
			}
		}
		return changedParameters;
	}

	public String[] getKeysInOrder(Map<String, String> receivedBalloonParamaters) {

		List<AttributeDefinition> keyAttributeDefinitions = this.getCollectSurvey().getSchema()
				.getRootEntityDefinition(EarthConstants.ROOT_ENTITY_NAME).getKeyAttributeDefinitions();
		String[] keys = new String[keyAttributeDefinitions.size()];

		BalloonInputFieldsUtils balloonInputFieldsUtils = new BalloonInputFieldsUtils();
		int i = 0;
		for (AttributeDefinition keyAttribute : keyAttributeDefinitions) {
			String balloonName = balloonInputFieldsUtils.getCollectBalloonParamName(keyAttribute);
			if (!receivedBalloonParamaters.containsKey(balloonName)) {
				throw new IllegalArgumentException(
						"The parameters received do not contain the mandatory parameter " + balloonName);
			}
			keys[i++] = receivedBalloonParamaters.get(balloonName);
		}

		return keys;
	}
}
