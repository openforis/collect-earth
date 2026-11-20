package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.TextAttribute;
import org.openforis.idm.model.expression.ExpressionFactory;

/**
 * Records kept apart from the local database (corrections, docs/plans/2026-11-20-review-at-scale.md C2): someone else's
 * answer read from its XML, corrected with the form's values, written back as XML, and never stored nor heard by the
 * listeners of the saves (the cloud sync would send it as the person's own record).
 */
class DetachedRecordTest {

	private static final String[] PLOT = { "105" };

	private AbstractEarthSurveyService service;
	private final List<CollectRecord> stored = new ArrayList<>();
	private final List<String> heard = new ArrayList<>();

	@BeforeEach
	void createService() throws Exception {
		RecordManager recordManager = new RecordManager() {
			@Override
			public CollectRecord create(CollectSurvey survey, EntityDefinition rootEntityDefinition, User user, String modelVersionName, String sessionId) {
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
				stored.add(record);
			}

			@Override
			public boolean isUnique(CollectRecord record) {
				return true;
			}
		};
		CollectValidator validator = new CollectValidator();
		validator.setCodeListManager(new CodeListManager());
		validator.setRecordManager(recordManager);
		CollectSurvey survey;
		try (InputStream idml = getClass().getResourceAsStream("/untouched_plot_survey.idm.xml")) {
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(
					new CollectSurveyContext(new ExpressionFactory(), validator, new InMemoryCodeListService())).unmarshal(idml);
		}
		survey.setId(1);
		// as a survey loaded by Collect Earth is: the records' XML names it
		survey.setUri("http://openforis.org/test/untouched_plot");
		Properties properties = new Properties();
		properties.setProperty(EarthProperty.DEFERRED_SAVE_DISABLED.toString(), "true");
		properties.setProperty(EarthProperty.OPERATOR_KEY.toString(), "rita");
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

	private static Map<String, String> plotValues() {
		Map<String, String> parameters = new HashMap<>();
		parameters.put("collect_text_id", PLOT[0]);
		parameters.put("collect_text_region", "north");
		return parameters;
	}

	/** Ana's answer, submitted, as the server keeps its XML */
	private String anasAnswer() throws Exception {
		Map<String, String> values = plotValues();
		values.put("collect_code_land_use", "F");
		CollectRecord record = service.newDetachedRecord(PLOT, values);
		Map<String, String> answer = plotValues();
		answer.put("collect_code_land_use", "F");
		answer.put("collect_text_operator", "ana");
		answer.put("collect_boolean_actively_saved", "true");
		service.updateDetachedRecord(record, answer, false);
		// the operator is the person's at each update: Ana's answer is Ana's
		((TextAttribute) record.findNodeByPath("/plot/operator")).setValue(new org.openforis.idm.model.TextValue("ana"));
		return service.detachedRecordXml(record);
	}

	@Test
	void anAnswerReadFromItsXmlIsCorrectedAndWrittenBackNeverStored() throws Exception {
		String xml = anasAnswer();
		CollectRecord correction = service.parseDetachedRecord(xml);
		assertNotNull(correction);
		assertEquals("F", code(correction, "land_use"));
		assertEquals("ana", text(correction, "operator"));
		assertTrue(PlotStatusOf.submitted(correction));

		// the start of the correction: not submitted any more, the person's
		service.startDetachedRecord(correction);
		assertFalse(PlotStatusOf.submitted(correction));
		assertEquals("rita", text(correction, "operator"));
		PlacemarkLoadResult loaded = service.loadDetachedRecord(correction);
		assertTrue(loaded.isSuccess());
		assertFalse(loaded.isActivelySaved());

		// corrected and submitted
		Map<String, String> values = plotValues();
		values.put("collect_code_land_use", "G");
		values.put("collect_boolean_actively_saved", "true");
		PlacemarkLoadResult result = service.updateDetachedRecord(correction, values, false);
		assertTrue(result.isSuccess());
		assertTrue(result.isActivelySaved());
		assertEquals("G", service.detachedRecordSummary(correction).get("collect_code_land_use"));
		assertEquals("G", code(service.parseDetachedRecord(service.detachedRecordXml(correction)), "land_use"));

		assertTrue(stored.isEmpty(), "never a record of the local database");
		assertTrue(heard.isEmpty(), "never heard by the cloud sync");
	}

	@Test
	void noRowToTakeOffIsSaidAndNothingIsStored() {
		CollectRecord record = service.newDetachedRecord(PLOT, plotValues());
		assertFalse(service.deleteEntityOfDetachedRecord(record, "trees").isSuccess(), "none");
		assertFalse(service.addEntityToDetachedRecord(record, "no_such_entity").isSuccess());
		assertTrue(stored.isEmpty());
		assertTrue(heard.isEmpty());
	}

	@Test
	void xmlThatIsNoRecordOfTheSurveyIsNone() {
		assertNull(service.parseDetachedRecord("<nothing/>"));
		assertNull(service.parseDetachedRecord("not xml"));
	}

	private static String text(CollectRecord record, String name) {
		TextAttribute attribute = record.findNodeByPath("/plot/" + name);
		return attribute == null || attribute.getValue() == null ? null : attribute.getValue().getValue();
	}

	private static String code(CollectRecord record, String name) {
		CodeAttribute attribute = record.findNodeByPath("/plot/" + name);
		return attribute == null || attribute.getValue() == null ? null : attribute.getValue().getCode();
	}

	/** Whether a record is submitted, as the plots map reads it */
	private static final class PlotStatusOf {
		static boolean submitted(CollectRecord record) {
			return AbstractEarthSurveyService.getPlotStatus(record) == AbstractEarthSurveyService.PlotStatus.SUBMITTED;
		}
	}
}
