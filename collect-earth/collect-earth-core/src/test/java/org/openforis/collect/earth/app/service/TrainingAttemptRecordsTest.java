package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.SubmitAfterRelevanceChangeTest.InMemoryCodeListService;
import org.openforis.collect.manager.CodeListManager;
import org.openforis.collect.manager.RecordManager;
import org.openforis.collect.model.CollectRecordSummary;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.model.RecordFilter;
import org.openforis.collect.model.validation.CollectValidator;
import org.openforis.collect.persistence.RecordPersistenceException;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.idm.model.expression.ExpressionFactory;

/**
 * A learning set's new attempt: Collect Earth deletes the interpreter's records of the set's plots saved before the
 * attempt started (deleteRecordsSavedBefore), on the survey of the tests, keeping the ones saved since and the other plots.
 */
class TrainingAttemptRecordsTest {

	private AbstractEarthSurveyService service;
	private SummariesRecordManager records;

	@BeforeEach
	void createService() throws Exception {
		records = new SummariesRecordManager();
		CollectValidator validator = new CollectValidator();
		validator.setCodeListManager(new CodeListManager());
		validator.setRecordManager(records);
		CollectSurvey survey;
		try (InputStream idml = getClass().getResourceAsStream("/untouched_plot_survey.idm.xml")) {
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(
					new CollectSurveyContext(new ExpressionFactory(), validator, new InMemoryCodeListService())).unmarshal(idml);
		}
		survey.setId(1);
		service = new AbstractEarthSurveyService() {
		};
		service.localPropertiesService = new LocalPropertiesService(new Properties());
		service.recordManager = records;
		service.setCollectSurvey(survey);
	}

	@Test
	void theRecordsSavedBeforeTheAttemptGoAndTheOthersStay() {
		Date start = new Date(1_800_000_000_000L);
		records.add(1, "9001", new Date(start.getTime() - 60_000));
		records.add(2, "9002", new Date(start.getTime() + 60_000));
		records.add(3, "9003", null);
		records.add(4, "1", new Date(start.getTime() - 60_000));

		int deleted = service.deleteRecordsSavedBefore(Arrays.asList(new String[] { "id" }, new String[] { "9001" },
				new String[] { "9002" }, new String[] { "9003" }), start);

		assertEquals(2, deleted, "the one saved before and the one without a date");
		assertEquals(Arrays.asList("9002", "1"), records.keys());
	}

	@Test
	void aRecordThatCannotBeDeletedDoesNotStopTheOthers() {
		Date start = new Date(1_800_000_000_000L);
		records.add(1, "9001", new Date(0));
		records.add(2, "9002", new Date(0));
		records.failing = 1;

		assertEquals(1, service.deleteRecordsSavedBefore(Arrays.asList(new String[] { "9001" }, new String[] { "9002" }), start));
		assertEquals(Arrays.asList("9001"), records.keys());
	}

	@Test
	void thePlotsAreKeyedByTheSurveysKeyAttributes() {
		assertEquals(1, service.getKeyAttributeCount());
	}

	/** Records as summaries (key and modified date), filtered by key values, deleted by id */
	private static class SummariesRecordManager extends RecordManager {
		private final Map<Integer, String[]> keys = new LinkedHashMap<>();
		private final Map<Integer, Date> modified = new LinkedHashMap<>();
		/** a record whose deletion fails */
		private int failing = -1;

		void add(int id, String key, Date modifiedOn) {
			keys.put(id, new String[] { key });
			modified.put(id, modifiedOn);
		}

		List<String> keys() {
			return keys.values().stream().map(k -> k[0]).collect(Collectors.toList());
		}

		@Override
		public List<CollectRecordSummary> loadSummaries(RecordFilter filter) {
			List<CollectRecordSummary> out = new ArrayList<>();
			for (Map.Entry<Integer, String[]> e : keys.entrySet()) {
				if (filter.getKeyValues() == null || Arrays.equals(filter.getKeyValues().toArray(new String[0]), e.getValue())) {
					CollectRecordSummary summary = new CollectRecordSummary();
					summary.setId(e.getKey());
					summary.setModifiedDate(modified.get(e.getKey()));
					out.add(summary);
				}
			}
			return out;
		}

		@Override
		public void delete(int id) throws RecordPersistenceException {
			if (id == failing) {
				throw new RecordPersistenceException("locked");
			}
			keys.remove(id);
			modified.remove(id);
		}
	}
}
