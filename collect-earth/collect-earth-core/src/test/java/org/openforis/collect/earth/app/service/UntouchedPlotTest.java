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
import org.openforis.idm.model.Attribute;
import org.openforis.idm.model.Code;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.TextValue;
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

	@Test
	public void aDefaultClearedComesBackAsItDoesOnAStoredRecord() {
		// Collect applies the default again to an empty attribute that has one: cleared as the first answer, nothing is
		// stored, and the form gets the default back
		open();
		PlacemarkLoadResult result = save("collect_text_assessment", "");
		assertEquals("visual", text(result.getCollectRecord(), "assessment"));
		assertTrue(recordManager.saved.isEmpty());

		// the same once the record is stored
		save("collect_text_assessment", "remote");
		result = save("collect_text_assessment", "");
		assertEquals("visual", text(result.getCollectRecord(), "assessment"));
		assertTrue(attribute(result.getCollectRecord(), "assessment").isDefaultValueApplied());
	}

	@Test
	public void anEmptyValueFromABalloonLeavesTheDefault() {
		// a balloon sends every field, those it has not filled empty
		Map<String, String> parameters = plotValues();
		parameters.put("collect_text_assessment", "");
		parameters.put("collect_text_notes", "");
		PlacemarkLoadResult result = service.updatePlacemarkData(PLOT, parameters, SESSION, false);

		assertEquals("visual", text(result.getCollectRecord(), "assessment"));
		assertTrue(recordManager.saved.isEmpty());
	}

	@Test
	public void theDefaultsABalloonSendsBackStayDefaults() {
		open();
		// the whole form, the defaults and calculations it was given back included, with one answer
		Map<String, String> parameters = plotValues();
		parameters.put("collect_text_assessment", "visual");
		// as the open gave it back: Collect evaluated it before the region was set, and does not evaluate it again
		parameters.put("collect_text_landmark", "near ");
		parameters.put("collect_text_region_label", "R-north");
		parameters.put("collect_text_notes", "");
		parameters.put("collect_code_land_use", "F");
		PlacemarkLoadResult result = service.updatePlacemarkData(PLOT, parameters, SESSION, true);

		CollectRecord record = result.getCollectRecord();
		assertEquals(1, recordManager.saved.size());
		assertTrue(attribute(record, "assessment").isDefaultValueApplied());
		assertTrue(attribute(record, "landmark").isDefaultValueApplied());
		assertEquals(PlotStatus.IN_PROGRESS, AbstractEarthSurveyService.getPlotStatus(record));
		assertFalse(AbstractEarthSurveyService.hasCollectorInput(withoutLandUse(record)), "the answer is the only one");
	}

	@Test
	public void theKeyOfARowAddedIsAnAnswerNotTheKeyOfAnEnumeratedRow() throws Exception {
		CollectSurvey survey;
		try (InputStream idml = getClass().getResourceAsStream("/row_keys_survey.idm.xml")) {
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(
					new CollectSurveyContext(new ExpressionFactory(), validator(), new InMemoryCodeListService())).unmarshal(idml);
		}
		CollectRecord record = new CollectRecord(survey, null, "plot");
		RecordUpdater updater = new RecordUpdater();
		updater.initializeNewRecord(record);
		Entity root = record.getRootEntity();
		updater.updateAttribute((TextAttribute) root.getChild("id"), new TextValue("105"));

		Entity cover = (Entity) updater.addEntity(root, "land_cover").getChanges().get(0).getNode();
		updater.updateAttribute((CodeAttribute) cover.getChild("cover_class"), new Code("F"));
		assertFalse(AbstractEarthSurveyService.hasCollectorInput(record), "the key of an enumerated row comes with the table");

		Entity tree = (Entity) updater.addEntity(root, "trees").getChanges().get(0).getNode();
		updater.updateAttribute((TextAttribute) tree.getChild("tree_no"), new TextValue("7"));
		assertTrue(AbstractEarthSurveyService.hasCollectorInput(record), "the key of a row added is typed");
	}

	@Test
	public void theStatusOfARecordSummaryIsReadFromItsRecordLoadedById() {
		open();
		save("collect_code_land_use", "F");
		CollectRecord stored = recordManager.saved.get(0);
		CollectRecordSummary summary = CollectRecordSummary.fromRecord(stored);

		assertEquals(PlotStatus.IN_PROGRESS, service.getPlotStatus(summary));
		save("collect_boolean_actively_saved", "true");
		assertEquals(PlotStatus.SUBMITTED, service.getPlotStatus(summary));
	}

	private CollectValidator validator() {
		CollectValidator validator = new CollectValidator();
		validator.setCodeListManager(new CodeListManager());
		validator.setRecordManager(recordManager);
		return validator;
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

	/** The record with the answer to land use cleared */
	private static CollectRecord withoutLandUse(CollectRecord record) {
		new RecordUpdater().updateAttribute((CodeAttribute) record.findNodeByPath("/plot/land_use"), (Code) null);
		return record;
	}

	private static Attribute<?, ?> attribute(CollectRecord record, String name) {
		return record.findNodeByPath("/plot/" + name);
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
			record.setId(saved.size());
		}

		@Override
		public CollectRecord load(CollectSurvey survey, int recordId, CollectRecord.Step step, boolean validate) {
			return saved.get(recordId - 1);
		}

		@Override
		public boolean isUnique(CollectRecord record) {
			return true;
		}
	}
}
