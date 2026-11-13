package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.SubmitAfterRelevanceChangeTest.InMemoryCodeListService;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.openforis.collect.manager.CodeListManager;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.model.RecordFilter;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.collect.model.User;
import org.openforis.collect.model.validation.CollectEarthValidator;
import org.openforis.collect.model.validation.CollectValidator;
import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.model.expression.ExpressionFactory;

/**
 * The records kept in memory (the deferred saves): written to the database before a job that writes it without the
 * service, and forgotten so the plot is read again from it; a save the request waits for that fails is reported.
 */
class WorkingRecordsTest {

	private static final String[] PLOT = { "105" };

	private final DatabaseRecordManager database = new DatabaseRecordManager();

	@Test
	void pendingChangesAreSavedThenTheRecordIsReadAgainFromTheDatabase() throws Exception {
		AbstractEarthSurveyService service = service(false);
		assertTrue(save(service).isSuccess());
		assertEquals(0, database.saves, "deferred");
		assertTrue(service.hasUnsavedChanges("105"));

		service.flushAndForgetWorkingRecords();
		assertEquals(1, database.saves);
		assertFalse(service.hasUnsavedChanges("105"));

		// deleted from the database by a job (Delete plots): no longer served from memory
		database.stored = null;
		assertFalse(service.loadPlacemarkExpanded(PLOT).isSuccess());
	}

	@Test
	void theResetOfALearningSetForgetsTheRecordsItDeletes() throws Exception {
		AbstractEarthSurveyService service = service(true);
		save(service);
		assertTrue(service.loadPlacemarkExpanded(PLOT).isSuccess());

		assertEquals(1, service.deleteRecordsSavedBefore(Collections.singletonList(PLOT), new Date(Long.MAX_VALUE)));
		assertFalse(service.loadPlacemarkExpanded(PLOT).isSuccess(), "the plot opens without its earlier answers");
	}

	@Test
	void aSaveTheRequestWaitsForThatFailsIsReported() throws Exception {
		AbstractEarthSurveyService service = service(true);
		database.failing = true;
		assertFalse(save(service).isSuccess());
	}

	private AbstractEarthSurveyService service(boolean saveAtOnce) throws Exception {
		CollectValidator validator = new CollectValidator();
		validator.setCodeListManager(new CodeListManager());
		validator.setRecordManager(database);
		CollectSurvey survey;
		try (InputStream idml = getClass().getResourceAsStream("/untouched_plot_survey.idm.xml")) {
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(
					new CollectSurveyContext(new ExpressionFactory(), validator, new InMemoryCodeListService())).unmarshal(idml);
		}
		survey.setId(1);
		Properties properties = new Properties();
		properties.setProperty(EarthProperty.DEFERRED_SAVE_DISABLED.toString(), String.valueOf(saveAtOnce));
		properties.setProperty(EarthProperty.OPERATOR_KEY.toString(), "anna");
		properties.setProperty(EarthProperty.UI_LANGUAGE.toString(), "en");
		AbstractEarthSurveyService service = new AbstractEarthSurveyService() {
		};
		service.localPropertiesService = new LocalPropertiesService(properties);
		service.recordManager = database;
		CollectEarthValidator collectEarthValidator = new CollectEarthValidator();
		collectEarthValidator.setCodeListManager(new CodeListManager());
		collectEarthValidator.setRecordManager(database);
		service.collectEarthValidator = collectEarthValidator;
		service.setCollectSurvey(survey);
		return service;
	}

	private static PlacemarkLoadResult save(AbstractEarthSurveyService service) {
		Map<String, String> parameters = new HashMap<>();
		parameters.put("collect_text_id", PLOT[0]);
		parameters.put("collect_text_region", "north");
		parameters.put("collect_code_land_use", "F");
		return service.updatePlacemarkData(PLOT, parameters, "session", true);
	}

	/** One plot's record, as a database holds it: loaded by its key, deleted by its id */
	private static class DatabaseRecordManager extends RecordManager {
		private CollectRecord stored;
		private int saves;
		private boolean failing;

		@Override
		public CollectRecord create(CollectSurvey survey, EntityDefinition rootEntityDefinition, User user,
				String modelVersionName, String sessionId) {
			CollectRecord record = new CollectRecord(survey, modelVersionName, rootEntityDefinition.getName());
			new RecordUpdater().initializeNewRecord(record);
			return record;
		}

		@Override
		public List<CollectRecordSummary> loadSummaries(RecordFilter filter) {
			List<CollectRecordSummary> summaries = new ArrayList<>();
			if (stored != null) {
				CollectRecordSummary summary = new CollectRecordSummary();
				summary.setId(1);
				summaries.add(summary);
			}
			return summaries;
		}

		@Override
		public CollectRecord load(CollectSurvey survey, int recordId, CollectRecord.Step step, boolean validate) {
			return stored;
		}

		@Override
		public void save(CollectRecord record, String sessionId) throws RecordPersistenceException {
			if (failing) {
				throw new RecordPersistenceException("database locked");
			}
			record.setId(1);
			stored = record;
			saves++;
		}

		@Override
		public void delete(int id) {
			stored = null;
		}

		@Override
		public boolean isUnique(CollectRecord record) {
			return true;
		}
	}
}
