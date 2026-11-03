package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService.PlotStatus;
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
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.expression.ExpressionFactory;

/**
 * Opening a plot stored its record at once, with the values of the plot file, the defaults and the calculations only, and
 * the plot showed as started (yellow) with nothing answered. Now the record is stored with the first answer, and one with
 * nothing answered counts as not started.
 */
class UntouchedPlotTest {

	private static final String[] PLOT = { "105" };
	private static final String SESSION = "session";

	private AbstractEarthSurveyService service;
	private StoringRecordManager recordManager;
	/** the records the listeners of the saves heard about */
	private final List<String> heard = new ArrayList<>();

	@BeforeEach
	void createService() throws Exception {
		recordManager = new StoringRecordManager();
		CollectValidator validator = new CollectValidator();
		validator.setCodeListManager(new CodeListManager());
		validator.setRecordManager(recordManager);
		CollectSurvey survey;
		try (InputStream idml = getClass().getResourceAsStream("/untouched_plot_survey.idm.xml")) {
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(
					new CollectSurveyContext(new ExpressionFactory(), validator, new InMemoryCodeListService())).unmarshal(idml);
		}
		survey.setId(1);

		Properties properties = new Properties();
		properties.setProperty(EarthProperty.DEFERRED_SAVE_DISABLED.toString(), "true");
		properties.setProperty(EarthProperty.OPERATOR_KEY.toString(), "anna");
		properties.setProperty(EarthProperty.UI_LANGUAGE.toString(), "en");

		service = new AbstractEarthSurveyService() {
		};
		service.localPropertiesService = new LocalPropertiesService(properties);
		service.recordManager = recordManager;
		CollectEarthValidator collectEarthValidator = new CollectEarthValidator();
		collectEarthValidator.setCodeListManager(new CodeListManager());
		collectEarthValidator.setRecordManager(recordManager);
		service.collectEarthValidator = collectEarthValidator;
		service.setCollectSurvey(survey);
		service.addRecordSavedListener((key, record) -> heard.add(key));
	}

	@Test
	void openingAPlotStoresNothingAndGivesTheNewRecordBack() {
		PlacemarkLoadResult result = open();

		assertTrue(result.isSuccess());
		assertEquals(0, recordManager.saved.size(), "nothing answered: no record stored");
		assertTrue(heard.isEmpty(), "and no save heard");
		// the form gets the defaults and the calculations of the new record all the same
		assertEquals("visual", text(result.getCollectRecord(), "assessment"));
		assertEquals("R-north", text(result.getCollectRecord(), "region_label"));
	}

	@Test
	void aRecordWithOnlyThePlotFileDefaultsAndCalculationsIsNotStarted() {
		// what opening a plot stored before
		CollectRecord storedByOpening = open().getCollectRecord();

		assertFalse(AbstractEarthSurveyService.hasCollectorInput(storedByOpening));
		assertEquals(PlotStatus.NOT_STARTED, AbstractEarthSurveyService.getPlotStatus(storedByOpening));
		assertEquals(PlotStatus.NOT_STARTED, AbstractEarthSurveyService.getPlotStatus((CollectRecord) null));
	}

	@Test
	void theFirstAnswerStoresTheRecordOnceAndStartsThePlot() {
		open();
		PlacemarkLoadResult result = save("collect_code_land_use", "F");

		assertEquals(1, recordManager.saved.size());
		assertEquals(1, heard.size());
		assertEquals(PlotStatus.IN_PROGRESS, AbstractEarthSurveyService.getPlotStatus(result.getCollectRecord()));
	}

	@Test
	void aDefaultValueChangedByTheCollectorIsAnAnswer() {
		open();
		PlacemarkLoadResult result = save("collect_text_assessment", "remote");

		assertEquals(PlotStatus.IN_PROGRESS, AbstractEarthSurveyService.getPlotStatus(result.getCollectRecord()));
		assertEquals(1, heard.size());
	}

	@Test
	void aSubmitIsHeardOnceAndThePlotIsSubmitted() {
		open();
		save("collect_code_land_use", "F");
		PlacemarkLoadResult result = save("collect_boolean_actively_saved", "true");

		assertTrue(result.isActivelySaved());
		assertEquals(2, heard.size(), "the answer, then the submit");
		assertEquals(PlotStatus.SUBMITTED, AbstractEarthSurveyService.getPlotStatus(result.getCollectRecord()));
	}

	@Test
	void aPlotSubmittedWithNothingStoredBeforeIsStoredSubmitted() {
		// every question optional or answered by its default: submitted right after opening
		open();
		PlacemarkLoadResult result = save("collect_boolean_actively_saved", "true");

		assertTrue(result.isActivelySaved());
		assertEquals(1, recordManager.saved.size());
		assertEquals(1, heard.size());
		assertEquals(PlotStatus.SUBMITTED, AbstractEarthSurveyService.getPlotStatus(recordManager.saved.get(0)));
	}

	@Test
	void deletingARowOfAPlotWithNoRecordFailsQuietly() {
		open();
		Map<String, String> parameters = plotValues();

		PlacemarkLoadResult result = service.updatePlacemarkDeleteEntity(PLOT, "trees", parameters, SESSION);

		assertFalse(result.isSuccess());
		assertTrue(heard.isEmpty());
	}

	/** The save the form sends when it opens a plot with no record: the values of the plot file only */
	private PlacemarkLoadResult open() {
		Map<String, String> parameters = plotValues();
		parameters.put("collect_boolean_actively_saved", "false");
		return service.updatePlacemarkData(PLOT, parameters, SESSION, false);
	}

	private PlacemarkLoadResult save(String parameter, String value) {
		Map<String, String> parameters = plotValues();
		parameters.put(parameter, value);
		PlacemarkLoadResult result = service.updatePlacemarkData(PLOT, parameters, SESSION, true);
		assertTrue(result.isSuccess());
		return result;
	}

	private static Map<String, String> plotValues() {
		Map<String, String> parameters = new HashMap<>();
		parameters.put("collect_text_id", PLOT[0]);
		parameters.put("collect_text_region", "north");
		return parameters;
	}

	private static String text(CollectRecord record, String name) {
		TextAttribute attribute = record.findNodeByPath("/plot/" + name);
		return attribute == null || attribute.getValue() == null ? null : attribute.getValue().getValue();
	}

	/** Keeps the records saved; none is read back from a database (the service keeps the one being edited) */
	private static class StoringRecordManager extends RecordManager {

		private final List<CollectRecord> saved = new ArrayList<>();

		@Override
		public CollectRecord create(CollectSurvey survey, EntityDefinition rootEntityDefinition, User user,
				String modelVersionName, String sessionId) {
			CollectRecord record = new CollectRecord(survey, modelVersionName, rootEntityDefinition.getName());
			new RecordUpdater().initializeNewRecord(record);
			return record;
		}

		@Override
		public List<CollectRecordSummary> loadSummaries(RecordFilter filter) {
			return Collections.emptyList();
		}

		@Override
		public void save(CollectRecord record, String sessionId) {
			saved.add(record);
		}

		@Override
		public boolean isUnique(CollectRecord record) {
			return true;
		}
	}
}
