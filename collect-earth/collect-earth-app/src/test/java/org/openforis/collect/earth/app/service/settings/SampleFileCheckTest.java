package org.openforis.collect.earth.app.service.settings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.io.metadata.collectearth.CSVFileValidationResult;
import org.openforis.collect.io.metadata.collectearth.CSVFileValidationResult.ErrorType;
import org.openforis.collect.io.metadata.collectearth.CSVRowValidationResult;

/** The plots file as the page shows it before it is applied, with the check of Collect stood in for. */
public class SampleFileCheckTest {

	private static final List<String> EXPECTED = Arrays.asList("id", "YCoordinate", "XCoordinate", "elevation", "slope", "aspect");

	@TempDir
	File folder;

	private CSVFileValidationResult result = new CSVFileValidationResult();

	private final SampleFileCheck check = new SampleFileCheck(file -> result, () -> EXPECTED);

	private File csv(String name, String... lines) throws IOException {
		File file = new File(folder, name);
		Files.write(file.toPath(), Arrays.asList(lines), StandardCharsets.UTF_8);
		return file;
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> problems(Map<String, Object> answer) {
		return (List<Map<String, Object>>) answer.get("problems");
	}

	@Test
	public void aMissingFileIsABlockingProblem() {
		Map<String, Object> answer = check.check(new File(folder, "nowhere.csv").getAbsolutePath());
		assertEquals(false, answer.get("exists"));
		assertEquals(0, answer.get("plots"));
		assertEquals(EXPECTED, answer.get("expectedColumns"));
		assertEquals("missing", problems(answer).get(0).get("code"));
		assertEquals(Messages.getString("SettingsPage.sampleFile.missing"), problems(answer).get(0).get("message"));
		assertTrue(SampleFileCheck.isBlocking(answer));
		assertTrue(SampleFileCheck.isBlocking(check.check(" ")));
	}

	@Test
	public void thePlotsTheirColumnsAndWhereTheyAre() throws Exception {
		File file = csv("plots.csv", "id,YCoordinate,XCoordinate,elevation,slope,aspect", "1,41.5,2.1,100,0,0", "", "2,41.6,2.2,120,0,0",
				"3,41.7,2.3,140,0,0");
		Map<String, Object> answer = check.check(file.getAbsolutePath());
		assertEquals(true, answer.get("exists"));
		assertEquals(3, answer.get("plots"));
		assertEquals(Arrays.asList("id", "YCoordinate", "XCoordinate", "elevation", "slope", "aspect"), answer.get("foundColumns"));
		assertEquals(Arrays.asList("1", "41.5", "2.1", "100", "0", "0"), ((List<?>) answer.get("rows")).get(0));
		assertEquals(3, ((List<?>) answer.get("rows")).size());
		assertEquals(Arrays.asList(41.5, 2.1), ((List<?>) answer.get("points")).get(0));
		assertEquals(3, ((List<?>) answer.get("points")).size());
		assertTrue(problems(answer).isEmpty());
		assertFalse(SampleFileCheck.isBlocking(answer));
	}

	@Test
	public void aFileWithoutAHeaderRowAndWithAnotherSeparator() throws Exception {
		File file = csv("plots.csv", "1;41.5;2.1", "2;41.6;2.2");
		Map<String, Object> answer = check.check(file.getAbsolutePath());
		assertEquals(2, answer.get("plots"));
		assertEquals(Collections.emptyList(), answer.get("foundColumns"));
		assertEquals(2, ((List<?>) answer.get("rows")).size());
	}

	@Test
	public void theRowsAndPointsShownAreBounded() throws Exception {
		List<String> lines = new ArrayList<>();
		lines.add("id,YCoordinate,XCoordinate");
		for (int i = 0; i < 30; i++) {
			lines.add(i + "," + (40 + i / 100d) + "," + (2 + i / 100d));
		}
		File file = csv("many.csv", lines.toArray(new String[0]));
		Map<String, Object> answer = check.check(file.getAbsolutePath());
		assertEquals(30, answer.get("plots"));
		assertEquals(SampleFileCheck.PREVIEW_ROWS, ((List<?>) answer.get("rows")).size());
		assertEquals(30, ((List<?>) answer.get("points")).size());
	}

	@Test
	public void aFileThatIsNoCsvIsABlockingProblem() throws Exception {
		File file = csv("notes.txt", "just some text", "on two lines");
		Map<String, Object> answer = check.check(file.getAbsolutePath());
		assertEquals(true, answer.get("exists"));
		assertEquals("INVALID_FILE_TYPE", problems(answer).get(0).get("code"));
		assertEquals(Messages.getString("JPlotCsvTable.expectedFileType"), problems(answer).get(0).get("message"));
		assertTrue(SampleFileCheck.isBlocking(answer));
	}

	@Test
	public void anEmptyFileHasNoPlots() throws Exception {
		File file = csv("empty.csv", "id,YCoordinate,XCoordinate");
		Map<String, Object> answer = check.check(file.getAbsolutePath());
		assertEquals(0, answer.get("plots"));
		assertEquals("noRows", problems(answer).get(0).get("code"));
		assertFalse(SampleFileCheck.isBlocking(answer));
	}

	@Test
	public void whatCollectFindsIsSaidAsTheDialogSaidIt() throws Exception {
		File file = csv("plots.csv", "id,YCoordinate,XCoordinate", "1,41.5,2.1");
		result = new CSVFileValidationResult(ErrorType.INVALID_HEADERS, EXPECTED, Arrays.asList("id", "lat", "lon"));
		Map<String, Object> problem = problems(check.check(file.getAbsolutePath())).get(0);
		assertEquals("INVALID_HEADERS", problem.get("code"));
		assertEquals(String.format(Messages.getString("JPlotCsvTable.expectedColumns"), EXPECTED), problem.get("message"));
		assertEquals(false, problem.get("blocking"));

		result = new CSVFileValidationResult(ErrorType.INVALID_NUMBER_OF_COLUMNS);
		assertTrue(SampleFileCheck.isBlocking(check.check(file.getAbsolutePath())));

		result = new CSVFileValidationResult(ErrorType.INVALID_NUMBER_OF_PLOTS_WARNING);
		result.setNumberOfRows(5000);
		problem = problems(check.check(file.getAbsolutePath())).get(0);
		assertEquals(String.format(Messages.getString("JPlotCsvTable.tooLargeWarning"), 5000), problem.get("message"));
		assertEquals(false, problem.get("blocking"));

		result = new CSVFileValidationResult(ErrorType.INVALID_VALUES_IN_CSV);
		result.setRowValidations(Arrays.asList(new CSVRowValidationResult(2, ErrorType.INVALID_VALUES_IN_CSV, 4, "not a number")));
		problem = problems(check.check(file.getAbsolutePath())).get(0);
		assertEquals(Messages.getString("JPlotCsvTable.contentIncorrect"), problem.get("message"));
		assertEquals(true, problem.get("blocking"));
		Map<?, ?> cell = (Map<?, ?>) ((List<?>) problem.get("details")).get(0);
		assertEquals(2, cell.get("row"));
		assertEquals(4, cell.get("column"));
		assertEquals("not a number", cell.get("message"));

		// No survey to check against: only what the file itself says
		result = null;
		assertTrue(problems(check.check(file.getAbsolutePath())).isEmpty());
	}
}
