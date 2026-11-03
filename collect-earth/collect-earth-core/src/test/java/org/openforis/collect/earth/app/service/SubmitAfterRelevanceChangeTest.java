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
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
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
import org.openforis.idm.metamodel.CodeAttributeDefinition;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CodeListItem;
import org.openforis.idm.metamodel.CodeListService;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.ModelVersion;
import org.openforis.idm.model.BooleanAttribute;
import org.openforis.idm.model.Code;
import org.openforis.idm.model.CodeAttribute;
import org.openforis.idm.model.Entity;
import org.openforis.idm.model.expression.ExpressionFactory;

/**
 * Choosing an answer that makes other questions required, then changing it back, left the plot impossible to submit : the
 * record kept counting the answers missing from questions that were no longer asked, and the form had nothing in error to show
 */
class SubmitAfterRelevanceChangeTest {

	private static final String[] PLOT = { "105" };
	private static final String SESSION = "session";

	private AbstractEarthSurveyService service;

	@BeforeEach
	void createService() throws Exception {
		InMemoryRecordManager recordManager = new InMemoryRecordManager();
		CollectValidator validator = new CollectValidator();
		validator.setCodeListManager(new CodeListManager());
		validator.setRecordManager(recordManager);
		CollectSurvey survey;
		try (InputStream idml = getClass().getResourceAsStream("/relevance_survey.idm.xml")) {
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
	}

	@Test
	void aPlotIsSubmittedAfterAnAnswerThatMadeOthersRequiredIsChangedBack() {
		save("collect_code_land_use", "F");
		save("collect_code_forest_dynamics", "degradation");
		save("collect_code_forest_dynamics", "none");

		PlacemarkLoadResult result = submit();

		assertTrue(result.isActivelySaved(), "The plot has every answer it needs, it is submitted");
		assertTrue(isActivelySaved(result.getCollectRecord()));
		assertEquals(0, result.getCollectRecord().getMissingErrors());
	}

	@Test
	void aPlotIsSubmittedWhenTheAnswerIsChosenDirectly() {
		save("collect_code_land_use", "F");
		save("collect_code_forest_dynamics", "none");

		assertTrue(submit().isActivelySaved());
	}

	@Test
	void aPlotWithRequiredQuestionsUnansweredIsStillNotSubmitted() {
		save("collect_code_land_use", "F");
		save("collect_code_forest_dynamics", "degradation");

		PlacemarkLoadResult result = submit();

		assertFalse(result.isActivelySaved());
		assertFalse(isActivelySaved(result.getCollectRecord()));
	}

	private PlacemarkLoadResult save(String parameter, String value) {
		Map<String, String> parameters = new HashMap<>();
		parameters.put("collect_text_id", PLOT[0]);
		parameters.put(parameter, value);
		PlacemarkLoadResult result = service.updatePlacemarkData(PLOT, parameters, SESSION, true);
		assertTrue(result.isSuccess());
		return result;
	}

	private PlacemarkLoadResult submit() {
		return save("collect_boolean_actively_saved", "true");
	}

	private static boolean isActivelySaved(CollectRecord record) {
		BooleanAttribute attribute = record.findNodeByPath("/plot/actively_saved");
		return attribute != null && attribute.getValue() != null && Boolean.TRUE.equals(attribute.getValue().getValue());
	}

	/** Records kept in memory : the service keeps the one being edited, and nothing is read back from a database */
	private static class InMemoryRecordManager extends RecordManager {

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
		}

		@Override
		public boolean isUnique(CollectRecord record) {
			return true;
		}
	}

	/** The items of the code lists of the survey, without a database */
	private static class InMemoryCodeListService implements CodeListService {

		@SuppressWarnings("unchecked")
		@Override
		public <T extends CodeListItem> T loadItem(CodeAttribute attribute) {
			Code value = attribute.getValue();
			for (CodeListItem item : attribute.getDefinition().getList().getItems()) {
				if (value != null && item.getCode().equals(value.getCode())) {
					return (T) item;
				}
			}
			return null;
		}

		@Override
		public <T extends CodeListItem> List<T> loadRootItems(CodeList codeList) {
			return codeList.getItems();
		}

		@Override
		public <T extends CodeListItem> T loadRootItem(CodeList list, String code, ModelVersion version) {
			return null;
		}

		@Override
		public <T extends CodeListItem> List<T> loadChildItems(T parentItem) {
			return parentItem.getChildItems();
		}

		@Override
		public <T extends CodeListItem> List<T> loadItems(CodeList codeList, int level) {
			return codeList.getItems();
		}

		@Override
		public boolean hasItems(Entity parent, CodeAttributeDefinition def) {
			return !def.getList().getItems().isEmpty();
		}

		@Override
		public <T extends CodeListItem> List<T> loadValidItems(Entity parent, CodeAttributeDefinition def) {
			return new ArrayList<>(def.getList().<T>getItems());
		}

		@Override
		public <T extends CodeListItem> T loadParentItem(T item) {
			return null;
		}

		@Override
		public boolean hasQualifiableItems(CodeList codeList) {
			return codeList.getItems().stream().anyMatch(CodeListItem::isQualifiable);
		}

		@Override
		public <T extends CodeListItem> void save(T item) {
		}

		@Override
		public <T extends CodeListItem> void save(List<T> items) {
		}

		@Override
		public <T extends CodeListItem> void delete(T item) {
		}

		@Override
		public void deleteAllItems(CodeList list) {
		}
	}
}
