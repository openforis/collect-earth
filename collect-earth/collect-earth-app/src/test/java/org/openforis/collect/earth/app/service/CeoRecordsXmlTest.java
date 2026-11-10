package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.core.handlers.BalloonInputFieldsUtils;
import org.openforis.collect.model.CollectRecord;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.model.CollectSurveyContext;
import org.openforis.collect.model.RecordUpdater;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.collect.persistence.xml.DataUnmarshaller;
import org.openforis.collect.persistence.xml.DataUnmarshaller.ParseRecordResult;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The records the cloud's import of Collect Earth Online answers writes (collect-earth-cloud/src/ceo/answers.ts, plan
 * docs/plans/2026-11-09-ceo-bridge.md, Part C), read by Collect's own record parser against the survey the cloud
 * serves, as Collect Earth reads the records of a cloud backup. Their summary, as Collect Earth makes it
 * (BalloonInputFieldsUtils.getValuesByHtmlParameters, what CloudRecordSerializer sends), must be the one the cloud
 * stored: the dashboard and the exports read that one. The files are written by the cloud's test
 * (test/ceoImport.routes.test.ts) into src/test/resources/ceo/answers/<project>: 20170 from sample data made by the rules
 * of CEO's code, 37 (RLCMS Cambodia) from a real download.
 */
public class CeoRecordsXmlTest {

	@Test
	public void theImportedRecordsReadInCollectAsTheCloudSummarizedThem() throws Exception {
		File[] projects = new File(resource("ceo/answers").toURI()).listFiles(File::isDirectory);
		assertTrue(projects != null && projects.length > 0, "no project to read");
		Arrays.sort(projects);
		List<String> problems = new ArrayList<>();
		for (File folder : projects) {
			readProject(folder, problems);
		}
		assertTrue(problems.isEmpty(), String.join("\n", problems));
	}

	/** One project's records against its survey, the problems added to {@code problems}. */
	private static void readProject(File folder, List<String> problems) throws Exception {
		CollectSurvey survey;
		try (InputStream is = new FileInputStream(new File(folder, "placemark.idm.xml"))) {
			survey = (CollectSurvey) new CollectSurveyIdmlBinder(new CollectSurveyContext()).unmarshal(is, true);
		}
		File[] records = folder.listFiles((dir, name) -> name.endsWith(".xml") && !name.equals("placemark.idm.xml"));
		assertTrue(records != null && records.length > 0, "no record to read");
		Arrays.sort(records);

		ObjectMapper json = new ObjectMapper();
		for (File file : records) {
			ParseRecordResult result;
			try (Reader reader = new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)) {
				result = new DataUnmarshaller(survey).parse(reader);
			}
			if (!result.isSuccess() || result.getRecord() == null) {
				problems.add(folder.getName() + "/" + file.getName() + ": not read: " + result.getFailures());
				continue;
			}
			if (result.hasWarnings()) {
				problems.add(folder.getName() + "/" + file.getName() + ": warnings: " + result.getWarnings());
			}
			CollectRecord record = result.getRecord();
			// As Collect Earth loads a record: the attributes left empty get their node (Collect's parser makes none for an
			// empty element), so the summary has them, empty, as the summary of a record the desktop sends has
			RecordUpdater updater = new RecordUpdater();
			updater.setValidateAfterUpdate(false);
			updater.initializeRecord(record);
			Map<String, String> made = new TreeMap<>();
			new BalloonInputFieldsUtils().getValuesByHtmlParameters(record.getRootEntity())
					.forEach((key, value) -> made.put(key, value == null ? "" : value));
			File summaryFile = new File(folder, file.getName().replace(".xml", ".summary.json"));
			Map<String, String> stored = new TreeMap<>(json.readValue(summaryFile, new TypeReference<Map<String, String>>() {
			}));
			if (!made.equals(stored)) {
				problems.add(folder.getName() + "/" + file.getName() + ": the summary Collect Earth makes differs from the cloud's: " + difference(made, stored));
			}
		}
	}

	private static String difference(Map<String, String> made, Map<String, String> stored) {
		List<String> out = new ArrayList<>();
		for (String key : new java.util.TreeSet<>(union(made, stored))) {
			String a = made.get(key);
			String b = stored.get(key);
			if (a == null ? b != null : !a.equals(b)) {
				out.add(key + ": Collect Earth " + (a == null ? "(none)" : "\"" + a + "\"") + ", cloud " + (b == null ? "(none)" : "\"" + b + "\""));
			}
		}
		return String.join("; ", out);
	}

	private static java.util.Set<String> union(Map<String, String> a, Map<String, String> b) {
		java.util.Set<String> keys = new java.util.HashSet<>(a.keySet());
		keys.addAll(b.keySet());
		return keys;
	}

	private static URL resource(String path) {
		URL url = CeoRecordsXmlTest.class.getClassLoader().getResource(path);
		assertFalse(url == null, path + " is missing");
		return url;
	}

	@Test
	public void theSummaryHoldsWhatTheCollectorAnswered() throws Exception {
		Map<String, String> summary = new ObjectMapper().readValue(
				new File(resource("ceo/answers/20170/138814414_1-ceo-collector-1.summary.json").toURI()), new TypeReference<Map<String, String>>() {
				});
		assertEquals("degradation", summary.get("collect_code_visible_strata"));
		assertEquals("logging road, near the river", summary.get("collect_text_secondary_notes_or_type_of_other"));
	}
}
