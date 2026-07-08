package org.openforis.collect.earth.app.service;

import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_ATTRIBUTE_NAME;
import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_ON_ATTRIBUTE_NAME;
import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_ON_PARAMETER;
import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_ON_PARAMETER_OLD;
import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_PARAMETER;
import static org.openforis.collect.earth.app.EarthConstants.COLLECT_REASON_BLANK_NOT_SPECIFIED_MESSAGE;
import static org.openforis.collect.earth.app.EarthConstants.OPERATOR_PARAMETER;
import static org.openforis.collect.earth.app.EarthConstants.PLACEMARK_FOUND_PARAMETER;
import static org.openforis.collect.earth.app.EarthConstants.ROOT_ENTITY_NAME;
import static org.openforis.collect.earth.app.EarthConstants.SKIP_FILLED_PLOT_PARAMETER;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import javax.swing.JOptionPane;

import org.openforis.collect.earth.CollectEarthSurveyContext;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.handlers.BalloonInputFieldsUtils;
import org.openforis.collect.earth.core.handlers.DateAttributeHandler;
import org.openforis.collect.earth.core.model.PlacemarkInputFieldInfo;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.NodeChange;
import org.openforis.collect.model.NodeChangeSet;
import org.openforis.collect.model.NodeDeleteChange;
import org.openforis.collect.model.RecordFilter;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.collect.model.RecordValidationReportGenerator;
import org.openforis.collect.model.RecordValidationReportItem;
import org.openforis.collect.model.validation.CollectEarthValidator;
import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.ModelVersion;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NodeLabel.Type;
import org.openforis.idm.metamodel.Schema;
import org.openforis.idm.metamodel.SurveyContext;
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

public abstract class AbstractEarthSurveyService {

	private static final String COLLECT_CODE_CROWN_COVER = "collect_code_crown_cover";

	private static final String COLLECT_CODE_CANOPY_COVER = "collect_code_canopy_cover";

	private static final String COLLECT_CODE_DEFORESTATION_REASON = "collect_code_deforestation_reason"; //$NON-NLS-1$

	protected final Logger logger = LoggerFactory.getLogger(this.getClass());

	private static final String PREVIEW_PLACEMARK_ID = "testPlacemark";
	private static final String PREVIEW_PLACEMARK_ID_PLACEHOLDER = "$[EXTRA_id]";

	@Autowired
	protected LocalPropertiesService localPropertiesService;
	@Autowired
	protected RecordManager recordManager;
	@Autowired
	protected SurveyManager surveyManager;
	@Autowired
	protected CollectEarthValidator collectEarthValidator;

	protected CollectSurvey collectSurvey;
	protected RecordUpdater recordUpdater;
	protected BalloonInputFieldsUtils collectParametersHandler;

	public AbstractEarthSurveyService() {
		collectParametersHandler = new BalloonInputFieldsUtils();
		recordUpdater = new RecordUpdater();
		recordUpdater.setClearDependentCodeAttributes(true);
		recordUpdater.setClearNotRelevantAttributes(true);
	}

	// ==================================================================================
	// Working-record cache + write-behind persistence.
	//
	// Rationale: every value change in the Google Earth balloon used to trigger three
	// remote database round-trips (load summaries + load full record + save). Against a
	// remote (e.g. AWS RDS) PostgreSQL this made data entry feel very slow. We now keep
	// the currently-edited record in memory, apply changes to it directly, and persist
	// asynchronously (write-behind) shortly after the last change, on explicit "submit &
	// validate", on plot switch (LRU eviction) and on application shutdown.
	// The behaviour can be disabled via the "deferred_save_disabled" property.
	// ==================================================================================

	/** Milliseconds of inactivity after the last change before a dirty record is flushed. */
	private static final long FLUSH_DEBOUNCE_MS = 1000;
	/** How often the background flusher checks for dirty records that are due to be saved. */
	private static final long FLUSH_POLL_MS = 500;
	/** Maximum number of records kept in memory at once (LRU-evicted, flushed on eviction). */
	private static final int MAX_WORKING_RECORDS = 200;

	private static class WorkingRecord {
		private final CollectRecord record;
		private boolean dirty;
		private long lastChangeAtMs;
		private String sessionId;

		WorkingRecord(CollectRecord record) {
			this.record = record;
		}
	}

	// Access-ordered map so that the eldest (least-recently-used) plot is evicted first.
	private final Map<String, WorkingRecord> workingRecords = new LinkedHashMap<String, WorkingRecord>(64, 0.75f, true) {
		private static final long serialVersionUID = 1L;

		@Override
		protected boolean removeEldestEntry(Map.Entry<String, WorkingRecord> eldest) {
			if (size() > MAX_WORKING_RECORDS) {
				flush(eldest.getValue());
				// Only evict if it was persisted successfully; never drop unsaved data.
				return !eldest.getValue().dirty;
			}
			return false;
		}
	};

	private ScheduledExecutorService flushExecutor;

	/**
	 * Callback invoked right after a record has been successfully persisted to the
	 * local database. Implementations MUST return quickly and MUST NOT throw: the
	 * callback runs while this service's monitor is held (e.g. during the
	 * write-behind flush and on LRU eviction). Intended for cheap bookkeeping such
	 * as enqueueing the record for background cloud synchronization.
	 */
	public interface RecordSavedListener {
		void recordSaved(String recordKeyCsv, CollectRecord record);
	}

	private final List<RecordSavedListener> recordSavedListeners = new CopyOnWriteArrayList<>();

	public void addRecordSavedListener(RecordSavedListener listener) {
		recordSavedListeners.add(listener);
	}

	private void notifyRecordSaved(CollectRecord record) {
		if (recordSavedListeners.isEmpty()) {
			return;
		}
		List<String> keyValues = record.getRootEntityKeyValues();
		String recordKeyCsv = keyValues == null ? "" : String.join(",", keyValues); //$NON-NLS-1$ //$NON-NLS-2$
		for (RecordSavedListener listener : recordSavedListeners) {
			try {
				listener.recordSaved(recordKeyCsv, record);
			} catch (Exception e) {
				logger.error("RecordSavedListener failed for record key " + recordKeyCsv, e); //$NON-NLS-1$
			}
		}
	}

	private boolean isDeferredSaveEnabled() {
		return localPropertiesService.isDeferredSaveEnabled();
	}

	private static String cacheKey(String[] keyAttributes) {
		return String.join(",", keyAttributes);
	}

	/**
	 * Returns the in-memory working copy of the record for the given plot, loading it
	 * from the database (and caching it) the first time it is requested. Returns
	 * {@code null} if no record exists yet for the plot.
	 */
	private CollectRecord getWorkingRecord(String key, String[] keyAttributes) {
		WorkingRecord wr = workingRecords.get(key);
		if (wr != null) {
			return wr.record;
		}
		CollectRecord record = loadRecord(keyAttributes);
		if (record != null) {
			workingRecords.put(key, new WorkingRecord(record));
		}
		return record;
	}

	/**
	 * Persist a record change. When deferred save is enabled and the change is not an
	 * explicit "submit &amp; validate", the record is only marked dirty and a background
	 * flush is scheduled; otherwise it is saved synchronously right away.
	 */
	private void persistOrDefer(String key, CollectRecord record, String sessionId, boolean saveNow) {
		WorkingRecord wr = workingRecords.get(key);
		if (wr == null) {
			wr = new WorkingRecord(record);
			workingRecords.put(key, wr);
		}
		wr.sessionId = sessionId;
		wr.dirty = true;
		wr.lastChangeAtMs = System.currentTimeMillis();
		if (saveNow || !isDeferredSaveEnabled()) {
			flush(wr);
		} else {
			scheduleBackgroundFlusher();
		}
	}

	/** Save a single dirty record to the database. Callers must hold this service's monitor. */
	private void flush(WorkingRecord wr) {
		if (wr == null || !wr.dirty) {
			return;
		}
		try {
			recordManager.save(wr.record, wr.sessionId);
			wr.dirty = false;
			notifyRecordSaved(wr.record);
		} catch (Exception e) {
			logger.error("Error flushing record to the database", e); //$NON-NLS-1$
		}
	}

	private synchronized void scheduleBackgroundFlusher() {
		if (flushExecutor == null) {
			flushExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
				Thread t = new Thread(r, "CollectEarth-record-flusher"); //$NON-NLS-1$
				t.setDaemon(true);
				return t;
			});
			flushExecutor.scheduleWithFixedDelay(this::flushDueRecords, FLUSH_POLL_MS, FLUSH_POLL_MS, TimeUnit.MILLISECONDS);
		}
	}

	private synchronized void flushDueRecords() {
		long now = System.currentTimeMillis();
		for (WorkingRecord wr : workingRecords.values()) {
			if (wr.dirty && now - wr.lastChangeAtMs >= FLUSH_DEBOUNCE_MS) {
				flush(wr);
			}
		}
	}

	/** Persist all pending (dirty) records. Called on shutdown and on survey/project change. */
	public synchronized void flushAll() {
		for (WorkingRecord wr : workingRecords.values()) {
			flush(wr);
		}
	}

	private void addLocalProperties(Map<String, String> placemarkParameters) {
		placemarkParameters.put(SKIP_FILLED_PLOT_PARAMETER,
				Boolean.toString(localPropertiesService.shouldJumpToNextPlot())); // $NON-NLS-1$
	}

	private void addResultParameter(Map<String, String> placemarkParameters, boolean found) {
		placemarkParameters.put(PLACEMARK_FOUND_PARAMETER, Boolean.toString(found)); // $NON-NLS-1$
	}

	/**
	* @deprecated Used for the 2013/14 versions of the surveys!
	*/
	@Deprecated
	private void addValidationMessages(Map<String, String> parameters, CollectRecord ceRecord) {
		// Validation
		recordUpdater.validate(ceRecord);

		final RecordValidationReportGenerator reportGenerator = new RecordValidationReportGenerator(ceRecord);
		final List<RecordValidationReportItem> validationItems = reportGenerator.generateValidationItems();

		for (final RecordValidationReportItem recordValidationReportItem : validationItems) {
			String label = ""; //$NON-NLS-1$
			if (recordValidationReportItem.getNodeId() != null) {
				final Node<?> node = ceRecord.getNodeByInternalId(recordValidationReportItem.getNodeId());
				label = node.getDefinition().getLabel(Type.INSTANCE,
						localPropertiesService.getUiLanguage().name().toLowerCase());

				String message = getAdaptedValidationMessage(recordValidationReportItem.getMessage());

				parameters.put("validation_" + node.getDefinition().getName(), label + " - " + message); //$NON-NLS-1$ //$NON-NLS-2$

			} else {
				label = recordValidationReportItem.getPath();
				parameters.put("validation_" + label, label + " - " + recordValidationReportItem.getMessage()); //$NON-NLS-1$ //$NON-NLS-2$
			}

		}

		if (!validationItems.isEmpty()) {
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

	private CollectRecord createRecord() {
		String modelVersionName = localPropertiesService.getModelVersionName();
		return recordManager.create(getCollectSurvey(),
				getRootEntityDefinition(), null, modelVersionName, null);
	}

	public EntityDefinition getRootEntityDefinition() {
		Schema schema = getCollectSurvey().getSchema();
		return schema.getRootEntityDefinition(ROOT_ENTITY_NAME);
	}

	public CollectSurvey getCollectSurvey() {
		return collectSurvey;
	}

	protected String getIdmFilePath() {
		return localPropertiesService.getImdFile();
	}

	public Map<String, String> getPlacemark(String[] keyAttributes, boolean validateRecord) {
		CollectRecord record = loadRecord(keyAttributes, validateRecord);
		Map<String, String> placemarkParameters = null;
		if (record == null) {
			placemarkParameters = new HashMap<>();
			addResultParameter(placemarkParameters, false);
		} else {
			placemarkParameters = collectParametersHandler.getValuesByHtmlParameters(record.getRootEntity());

			if ((placemarkParameters.get(COLLECT_CODE_CANOPY_COVER) != null) //$NON-NLS-1$
					&& placemarkParameters.get(COLLECT_CODE_CANOPY_COVER).equals("0")) { //$NON-NLS-1$ //$NON-NLS-2$
				placemarkParameters.put(COLLECT_CODE_CANOPY_COVER, //$NON-NLS-1$
						"0;" + COLLECT_CODE_DEFORESTATION_REASON + "="
								+ placemarkParameters.get(COLLECT_CODE_DEFORESTATION_REASON)); //$NON-NLS-1$
			}
			// For the PNG version with the old name
			if ((placemarkParameters.get(COLLECT_CODE_CROWN_COVER) != null) //$NON-NLS-1$
					&& placemarkParameters.get(COLLECT_CODE_CROWN_COVER).equals("0")) { //$NON-NLS-1$ //$NON-NLS-2$
				placemarkParameters.put(COLLECT_CODE_CROWN_COVER, //$NON-NLS-1$
						COLLECT_CODE_DEFORESTATION_REASON
								+ placemarkParameters.get(COLLECT_CODE_DEFORESTATION_REASON)); //$NON-NLS-1$
			}
			addResultParameter(placemarkParameters, true);
		}
		addLocalProperties(placemarkParameters);

		return placemarkParameters;
	}

	public synchronized PlacemarkLoadResult loadPlacemarkExpanded(String[] keyAttributeValues) {
		CollectRecord record;
		if (isPreviewRecordID(keyAttributeValues)) {
			try {
				record = createRecord();
				updateKeyAttributeValues(record, keyAttributeValues);
			} catch (Exception e) {
				record = null;
			}
		} else {
			// Serve (and cache) the in-memory working copy so that any not-yet-flushed
			// edits are shown when the balloon is reopened.
			record = getWorkingRecord(cacheKey(keyAttributeValues), keyAttributeValues);
		}
		if (record == null) {
			PlacemarkLoadResult result = new PlacemarkLoadResult();
			result.setSuccess(false);
			result.setMessage("No placemark found");
			return result;
		} else {
			return createPlacemarkLoadSuccessResult(record);
		}
	}

	public CollectRecord loadRecord(String[] mulitpleKeyAttributes) {
		return loadRecord(mulitpleKeyAttributes, true);
	}

	public synchronized CollectRecord loadRecord(String[] mulitpleKeyAttributes, boolean validateRecord) {
		RecordFilter rf = new RecordFilter(getCollectSurvey(), ROOT_ENTITY_NAME);
		rf.setKeyValues(mulitpleKeyAttributes);
		List<CollectRecordSummary> summaries = recordManager.loadSummaries(rf);
		if (summaries.isEmpty()) {
			return null;
		} else {
			return recordManager.load(getCollectSurvey(), summaries.get(0).getId(), Step.ENTRY, validateRecord);
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
	public List<CollectRecordSummary> getRecordSummariesSavedSince(Date updatedSince) {
		RecordFilter rf = new RecordFilter(getCollectSurvey(), ROOT_ENTITY_NAME);
		rf.setModifiedSince(updatedSince);
		return recordManager.loadSummaries(rf );
	}

	public String[] getPlacemarksId(List<CollectRecordSummary> listOfRecords) {
		if (listOfRecords == null) {
			return new String[0];
		}
		final String[] placemarkIds = new String[listOfRecords.size()];
		for (int i = 0; i < listOfRecords.size(); i++) {
			CollectRecordSummary recordSummary = listOfRecords.get(i);
			List<String> rootEntityKeyValues = recordSummary.getRootEntityKeyValues();
			StringBuilder keyValues = new StringBuilder();
			for (String key : rootEntityKeyValues) {
				keyValues.append(key).append(",");
			}

			placemarkIds[i] = keyValues.substring(0,keyValues.length()-1); // return the keys minus the last comma
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
		final List<CollectRecordSummary> recordsSavedForSurvey = recordManager.loadSummaries(
				new RecordFilter(getCollectSurvey(),ROOT_ENTITY_NAME)
		);

		if ((recordsSavedForSurvey != null) && !recordsSavedForSurvey.isEmpty()) {
			return getPlacemarksId(recordsSavedForSurvey);
		} else {
			return new String[]{};
		}
	}

	protected void checkVersions(CollectSurvey loadedCollectSurvey) {

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

	public synchronized void setCollectSurvey(CollectSurvey collectSurvey) {
		// Persist any pending changes and drop cached records: they belong to the
		// previous survey/project and must not leak into the new one.
		flushAll();
		workingRecords.clear();
		this.collectSurvey = collectSurvey;
		this.collectSurvey.setSurveyContext(createCollectEarthSurveyContext(collectSurvey.getContext()));
	}

	private CollectEarthSurveyContext createCollectEarthSurveyContext(SurveyContext collectSurveyContext) {
		return new CollectEarthSurveyContext(collectSurveyContext.getExpressionFactory(), collectEarthValidator, collectSurveyContext.getCodeListService());
	}

	private void setPlacemarkSavedOn(CollectRecord record) {
		String path = ROOT_ENTITY_NAME + "/" + ACTIVELY_SAVED_ON_ATTRIBUTE_NAME;
		Attribute<?, ?> attr = record.findNodeByPath(path);
		if (attr == null) {
			logger.warn("The expected attribute at {} could not be found!", path);
		} else {
			if (attr instanceof DateAttribute) {
				org.openforis.idm.model.Date date = org.openforis.idm.model.Date.parse(new Date());
				recordUpdater.updateAttribute((DateAttribute) attr, date);
			} else if (attr instanceof TextAttribute) {
				SimpleDateFormat sdf = new SimpleDateFormat("yyyy/MM/dd hh:mm");
				org.openforis.idm.model.Date date = org.openforis.idm.model.Date.parse(new Date());
				recordUpdater.updateAttribute((TextAttribute) attr, new TextValue(sdf.format(date)));
			} else {
				logger.error("Attribute {} is expected to be of type Text or Date", path);
			}
		}
	}

	private void setPlacemarkSavedActively(CollectRecord record, boolean value) {
		BooleanAttribute attr = record.findNodeByPath(ROOT_ENTITY_NAME + "/" + ACTIVELY_SAVED_ATTRIBUTE_NAME);
		recordUpdater.updateAttribute(attr, new BooleanValue(value));
	}

	private void setPlacemarkSavedOn(Map<String, String> parameters) {
		String dateSaved = new SimpleDateFormat( DateAttributeHandler.DATE_ATTRIBUTE_FORMAT ).format(new Date());

		parameters.put(ACTIVELY_SAVED_ON_PARAMETER, dateSaved);
		parameters.put(ACTIVELY_SAVED_ON_PARAMETER_OLD, dateSaved);
	}

	private void setPlacemarkSavedActively(Map<String, String> parameters, boolean value) {
		parameters.put(ACTIVELY_SAVED_PARAMETER, Boolean.toString(value)); // $NON-NLS-1$
	}

	public File getSurveyGuide() {
		File surveyGuide = new File(localPropertiesService.getProjectFolder(), "survey_guide.pdf" );
		if( surveyGuide.exists() && surveyGuide.canRead() ) {
			return surveyGuide;
		}else {
			return null;
		}
	}
	@Deprecated
	public synchronized boolean storePlacemarkOld(Map<String, String> parameters) {

		String[] keys = new String[] { parameters.get(EarthConstants.PLACEMARK_ID_PARAMETER) };
		RecordFilter rf = new RecordFilter(getCollectSurvey(), ROOT_ENTITY_NAME);
		rf.setKeyValues(keys);
		final List<CollectRecordSummary> summaries = recordManager.loadSummaries(rf); // $NON-NLS-1$
		boolean success = false;

		try {
			// Add the operator to the collected data
			parameters.put(OPERATOR_PARAMETER, localPropertiesService.getOperator());

			CollectRecord ceRecord = null;
			Entity plotEntity = null;

			if ( !summaries.isEmpty() ) { // DELETE IF ALREADY PRESENT
				recordManager.delete(summaries.get(0).getId());
				ceRecord = createRecord();
				plotEntity = ceRecord.getRootEntity();
			} else {
				// Create new record
				ceRecord = createRecord();
				plotEntity = ceRecord.getRootEntity();
			}

			boolean userClickOnSaveAndValidate = isPlacemarkSavedActively(parameters);

			setPlacemarkSavedOn(parameters);

			// Populate the data of the record using the HTTP parameters
			// received
			// This also generates the validation messages
			collectParametersHandler.saveToEntity(parameters, plotEntity);

			// Do not validate unless actively saved
			if (userClickOnSaveAndValidate) {
				addValidationMessages(parameters, ceRecord);

				// Check that there is no validation errors so the tick doesn't
				// turn green
				if (ceRecord.getSkipped() != 0 || ceRecord.getErrors() != 0) {
					setPlacemarkSavedActively(parameters, false);
					// Force saving again to remove the "actively saved"
					// parameter!
					collectParametersHandler.saveToEntity(parameters, plotEntity);
				}
			}

			ceRecord.setModifiedDate(new Date());
			recordManager.save(ceRecord);
			notifyRecordSaved(ceRecord);

			success = true;
		} catch (Exception e) {
			logger.error("Error while storing the record " + e.getMessage(), e); //$NON-NLS-1$
		}
		return success;
	}

	public synchronized PlacemarkLoadResult updatePlacemarkData(String[] plotKeyAttributes,
			Map<String, String> parameters, String sessionId, boolean partialUpdate) {
		try {
			// Add the operator to the collected data
			parameters.put(OPERATOR_PARAMETER, localPropertiesService.getOperator());

			if (isPreviewRecordID(plotKeyAttributes)) {
				return updatePreviewPlacemarkData(plotKeyAttributes, parameters);
			} else {
				String key = cacheKey(plotKeyAttributes);
				CollectRecord record = getWorkingRecord(key, plotKeyAttributes);
				if (record == null) {
					return updatePlacemarkDataNewRecord(plotKeyAttributes, parameters, sessionId, key);
				} else {
					return updatePlacemarkDataExistingRecord(parameters, sessionId, partialUpdate, record, key);
				}
			}
		} catch (Exception e) {
			logger.error("Error while storing the record " + e.getMessage(), e); //$NON-NLS-1$
			PlacemarkLoadResult result = new PlacemarkLoadResult();
			result.setSuccess(false);
			return result;
		}
	}
	
	private PlacemarkLoadResult updatePreviewPlacemarkData(String[] plotKeyAttributes, Map<String, String> parameters) {
		CollectRecord record = createRecord();

		collectParametersHandler.saveToEntity(parameters, record.getRootEntity());

		// update actively_saved_on attribute now, otherwise if it's empty
		// it counts as an error
		setPlacemarkSavedOn(record);
		setPlacemarkSavedActively(record, false);

		updateKeyAttributeValues(record, plotKeyAttributes);
		record.setModifiedDate(new Date());
		return createPlacemarkLoadSuccessResult(record);
	}


	private PlacemarkLoadResult updatePlacemarkDataNewRecord(String[] plotKeyAttributes, Map<String, String> parameters,
			String sessionId, String key) throws RecordPersistenceException {
		CollectRecord record = createRecord();

		collectParametersHandler.saveToEntity(parameters, record.getRootEntity(), true);

		// update actively_saved_on attribute now, otherwise if it's empty
		// it counts as an error
		setPlacemarkSavedOn(record);
		setPlacemarkSavedActively(record, false);

		updateKeyAttributeValues(record, plotKeyAttributes);
		record.setModifiedDate(new Date());
		persistOrDefer(key, record, sessionId, isPlacemarkSavedActively(parameters));
		return createPlacemarkLoadSuccessResult(record);
	}


	private PlacemarkLoadResult updatePlacemarkDataExistingRecord(Map<String, String> parameters, String sessionId,
			boolean partialUpdate, CollectRecord record, String key) throws RecordPersistenceException {
		// Populate the data of the record using the HTTP parameters
		// received
		Entity plotEntity = record.getRootEntity();

		Map<String, String> oldPlacemarkParameters = collectParametersHandler
				.getValuesByHtmlParameters(record.getRootEntity());
		Map<String, String> changedParameters = calculateChanges(oldPlacemarkParameters, parameters);

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

		if (userClickOnSubmitAndValidate && noErrors) {
			// only save data if the information is completely valid or if
			// the record is not already completely saved (green)
			record.setModifiedDate(new Date());
		}

		// Persisted synchronously when the user explicitly submits & validates, otherwise
		// deferred (write-behind) to keep interactive field changes fast on a remote DB.
		persistOrDefer(key, record, sessionId, userClickOnSubmitAndValidate);

		if (partialUpdate) {
			return createPlacemarkLoadSuccessResult(record, changeSet);
		} else {
			return createPlacemarkLoadSuccessResult(record);
		}
	}
	
	public synchronized PlacemarkLoadResult updatePlacemarkAddNewEntity(String[] plotKeyAttributes, String entityName,
			Map<String, String> parameters, String sessionId) {
		if (isPreviewRecordID(plotKeyAttributes)) {
			return updatePreviewPlacemarkAddNewEntity(plotKeyAttributes, entityName, parameters, sessionId);	
		} else {
			return updatePlacemarkAddNewEntityToExistingRecord(plotKeyAttributes, entityName, sessionId);
		}
	}

	private PlacemarkLoadResult updatePlacemarkAddNewEntityToExistingRecord(String[] plotKeyAttributes, String entityName, String sessionId) {
		try {
			String key = cacheKey(plotKeyAttributes);
			CollectRecord record = getWorkingRecord(key, plotKeyAttributes);
			Entity rootEntity = record.getRootEntity();
			NodeChangeSet changeSet = recordUpdater.addEntity(rootEntity, entityName);
			persistOrDefer(key, record, sessionId, true);
			return createPlacemarkLoadSuccessResult(record, changeSet);
		} catch (Exception e) {
			logger.error("Error creating new entity: " + e.getMessage(), e); //$NON-NLS-1$
			PlacemarkLoadResult result = new PlacemarkLoadResult();
			result.setSuccess(false);
			return result;
		}
	}
	
	public synchronized PlacemarkLoadResult updatePreviewPlacemarkAddNewEntity(String[] keyAttributes,
			String entityName, Map<String, String> parameters, String sessionId) {
		CollectRecord record = createRecord();
		Entity rootEntity = record.getRootEntity();
		collectParametersHandler.saveToEntity(parameters, rootEntity);
		NodeChangeSet changeSet = recordUpdater.addEntity(rootEntity, entityName);
		return createPlacemarkLoadSuccessResult(record, changeSet);
	}
	
	public synchronized PlacemarkLoadResult updatePlacemarkDeleteEntity(String[] plotKeyAttributes, String entityName,
			Map<String, String> parameters, String sessionId) {
		if (isPreviewRecordID(plotKeyAttributes)) {
			return updatePreviewPlacemarkDeleteEntity(plotKeyAttributes, entityName, parameters, sessionId);	
		} else {
			return updatePlacemarkDeleteEntityToExistingRecord(plotKeyAttributes, entityName, sessionId);
		}
	}

	private PlacemarkLoadResult updatePlacemarkDeleteEntityToExistingRecord(String[] plotKeyAttributes, String entityName, String sessionId) {
		try {
			String key = cacheKey(plotKeyAttributes);
			CollectRecord record = getWorkingRecord(key, plotKeyAttributes);
			Entity rootEntity = record.getRootEntity();
			List<Node<? extends NodeDefinition>> entities = rootEntity.getChildren(entityName);
			if (entities == null || entities.isEmpty()) {
				logger.warn("No entities found with name '{}' to delete", entityName);
				PlacemarkLoadResult result = new PlacemarkLoadResult();
				result.setSuccess(false);
				result.setMessage("No entity found to delete");
				return result;
			}
			Entity entityToDelete = (Entity) entities.get(entities.size() - 1);
			NodeChangeSet changeSet = recordUpdater.deleteNode(entityToDelete);
			persistOrDefer(key, record, sessionId, true);
			return createPlacemarkLoadSuccessResult(record, changeSet);
		} catch (Exception e) {
			logger.error("Error creating new entity: " + e.getMessage(), e); //$NON-NLS-1$
			PlacemarkLoadResult result = new PlacemarkLoadResult();
			result.setSuccess(false);
			return result;
		}
	}
	
	public synchronized PlacemarkLoadResult updatePreviewPlacemarkDeleteEntity(String[] keyAttributes,
			String entityName, Map<String, String> parameters, String sessionId) {
		CollectRecord record = createRecord();
		Entity rootEntity = record.getRootEntity();
		// populate preview record using parameters
		collectParametersHandler.saveToEntity(parameters, rootEntity);
		List<Node<? extends NodeDefinition>> entities = rootEntity.getChildren(entityName);
		if (entities == null || entities.isEmpty()) {
			logger.warn("No preview entities found with name '{}' to delete", entityName);
			PlacemarkLoadResult result = new PlacemarkLoadResult();
			result.setSuccess(false);
			result.setMessage("No entity found to delete");
			return result;
		}
		Entity entityToDelete = (Entity) entities.get(entities.size() - 1);
		NodeChangeSet changeSet = recordUpdater.deleteNode(entityToDelete);
		return createPlacemarkLoadSuccessResult(record, changeSet);
	}

	private PlacemarkLoadResult createPlacemarkLoadSuccessResult(CollectRecord record) {
		return createPlacemarkLoadSuccessResult(record, null);
	}

	private PlacemarkLoadResult createPlacemarkLoadSuccessResult(CollectRecord record, NodeChangeSet changeSet) {
		PlacemarkLoadResult result = new PlacemarkLoadResult();
		result.setSuccess(true);
		result.setCollectRecord(record);
		result.setSkipFilled(localPropertiesService.shouldJumpToNextPlot());
		LinkedHashMap<String, PlacemarkInputFieldInfo> infoByParameterName = collectParametersHandler
				.extractFieldInfoByParameterName(record, changeSet,
						localPropertiesService.getValue(EarthProperty.UI_LANGUAGE), // Get the value of the language that the survey was exported with (not the language on CE UI)
						localPropertiesService.getModelVersionName());
		// adjust error messages
		for (Entry<String, PlacemarkInputFieldInfo> entry : infoByParameterName.entrySet()) {
			PlacemarkInputFieldInfo info = entry.getValue();
			if (info.isInError()) {
				String message = info.getErrorMessage();
				info.setErrorMessage(getAdaptedValidationMessage(message));
			}
		}
		result.setInputFieldInfoByParameterName(infoByParameterName);
		if (changeSet != null) {
			for (NodeChange<?> nodeChange : changeSet.getChanges()) {
				if (nodeChange instanceof NodeDeleteChange) {
					result.setDeletedEntityDefName(nodeChange.getNode().getDefinition().getName());
				}
			}
		}
		return result;
	}

	private void updateKeyAttributeValues(CollectRecord record, String[] keyAttributeValues) {
		List<EntityDefinition> rootEntityDefinitions = getCollectSurvey().getSchema().getRootEntityDefinitions();
		if (rootEntityDefinitions == null || rootEntityDefinitions.isEmpty()) {
			logger.error("No root entity definitions found in survey schema");
			return;
		}
		List<AttributeDefinition> keyAttributeDefinitions = rootEntityDefinitions.get(0).getKeyAttributeDefinitions();
		for (int i = 0; i < keyAttributeValues.length; i++) {
			String keyValue = keyAttributeValues[i];
			AttributeDefinition keyAttrDef = keyAttributeDefinitions.get(i);
			Attribute<?, Value> keyAttr = record.findNodeByPath(keyAttrDef.getPath());
			Value keyVal;
			if (isPreviewRecordID(keyAttributeValues)) {
				keyVal = keyAttr.getDefinition().createValue(i == 0 ? PREVIEW_PLACEMARK_ID : "1");
			} else {
				keyVal = keyAttr.getDefinition().createValue(keyValue);
			}
			recordUpdater.updateAttribute(keyAttr, keyVal);

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

		List<AttributeDefinition> keyAttributeDefinitions = getRootEntityDefinition().getKeyAttributeDefinitions();
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

	public String[] getKeyNamesForSurvey() {

		List<AttributeDefinition> keyAttributeDefinitions = getRootEntityDefinition().getKeyAttributeDefinitions();
		String[] keys = new String[keyAttributeDefinitions.size()];

		int i = 0;
		for (AttributeDefinition keyAttribute : keyAttributeDefinitions) {
			keys[i++] = keyAttribute.getName();
		}

		return keys;
	}

	private boolean isPreviewRecordID(String[] keyAttributeValues) {
		if (keyAttributeValues.length >= 1) {
			String firstKeyAttributeValue = keyAttributeValues[0];
			return PREVIEW_PLACEMARK_ID_PLACEHOLDER.equals(firstKeyAttributeValue) ||
					PREVIEW_PLACEMARK_ID.equals(firstKeyAttributeValue);
		} else {
			return false;
		}
	}

}
