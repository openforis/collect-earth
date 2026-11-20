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
	public void theCoordinatesComeAfterAllTheKeyColumns() throws Exception {
		// A survey keyed by the plot and the round: read at columns 2 and 3, every plot had the round as its latitude
		File file = csv("rounds.csv", "id,round,YCoordinate,XCoordinate,elevation", "IBP1,1,42.48,1.42,2149", "IBP2,1,42.49,1.43,2123");
		Map<String, Object> answer = new SampleFileCheck(f -> result, () -> EXPECTED, () -> 2).check(file.getAbsolutePath());
		assertEquals(Arrays.asList("id", "round", "YCoordinate", "XCoordinate", "elevation"), answer.get("foundColumns"));
		assertEquals(Arrays.asList(Arrays.asList(42.48, 1.42), Arrays.asList(42.49, 1.43)), answer.get("points"));
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

		// Collect's warnings about the number of plots were Google Earth Pro's limits: not said any more
		for (ErrorType size : new ErrorType[] { ErrorType.INVALID_NUMBER_OF_PLOTS_WARNING, ErrorType.INVALID_NUMBER_OF_PLOTS_TOO_LARGE }) {
			result = new CSVFileValidationResult(size);
			result.setNumberOfRows(5000);
			assertTrue(problems(check.check(file.getAbsolutePath())).isEmpty(), size.name());
		}
		// what is said, past the plots Collect Earth is tested with: a warning, the file still used
		assertEquals(null, SampleFileCheck.tooManyPlots(SampleFileCheck.MAX_PLOTS_TESTED));
		problem = SampleFileCheck.tooManyPlots(SampleFileCheck.MAX_PLOTS_TESTED + 1);
		assertEquals(String.format(Messages.getString("JPlotCsvTable.tooLargeWarning"), SampleFileCheck.MAX_PLOTS_TESTED + 1, SampleFileCheck.MAX_PLOTS_TESTED), problem.get("message"));
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

	/** Plots in UTM metres, as a plot file of a survey in EPSG:32737 had them: Collect Earth takes WGS84 degrees only */
	@Test
	public void plotsOutOfTheRangeOfDegreesAreRefusedAndNamed() throws Exception {
		File file = csv("utm.csv", "id,YCoordinate,XCoordinate,elevation,slope,aspect", "a,-1.29,36.82,0,0,0", "u1,9857000,257000,0,0,0",
				"u2,-1.29,257100,0,0,0", "u3,9857200,257200,0,0,0", "u4,9857300,257300,0,0,0", "u5,9857400,257400,0,0,0",
				"u6,9857500,257500,0,0,0");
		Map<String, Object> answer = check.check(file.getAbsolutePath());
		Map<String, Object> problem = problems(answer).get(0);
		assertEquals("notWgs84Plots", problem.get("code"));
		assertEquals(true, problem.get("blocking"));
		assertTrue(SampleFileCheck.isBlocking(answer));
		String message = (String) problem.get("message");
		assertTrue(message.contains("u1, u2, u3, u4, u5, ...") && !message.contains("u6"), message);
		assertTrue(message.contains("EPSG:4326") && !message.contains("<br/>"), message);
		// the wrong cells marked in the rows shown: the latitude and the longitude of u1, the longitude only of u2
		List<?> cells = (List<?>) problem.get("details");
		assertEquals(Arrays.asList("2:2", "2:3", "3:3"), cells.subList(0, 3).stream()
				.map(c -> ((Map<?, ?>) c).get("row") + ":" + ((Map<?, ?>) c).get("column")).collect(java.util.stream.Collectors.toList()));
		// every plot still shows in the table, and the map draws them (it leaves out what is not degrees itself)
		assertEquals(7, answer.get("plots"));

		// Collect's own check of an EPSG:4326 survey says the same in English: said once, here
		result = new CSVFileValidationResult(ErrorType.INVALID_VALUES_IN_CSV);
		result.setRowValidations(Arrays.asList(
				new CSVRowValidationResult(2, ErrorType.INVALID_VALUES_IN_CSV, 2, "The latitude of a plot must be between -90 and 90 degrees!"),
				new CSVRowValidationResult(2, ErrorType.INVALID_VALUES_IN_CSV, 3, "The latitude of a plot must be between -180 and 180 degrees!")));
		assertEquals(Arrays.asList("notWgs84Plots"), codes(check.check(file.getAbsolutePath())));
		// with another problem as well, Collect's is said too
		result.setRowValidations(Arrays.asList(new CSVRowValidationResult(2, ErrorType.INVALID_VALUES_IN_CSV, 4, "not a number")));
		assertEquals(Arrays.asList("notWgs84Plots", "INVALID_VALUES_IN_CSV"), codes(check.check(file.getAbsolutePath())));
	}

	@Test
	public void aSurveyInAnotherSystemIsSaidOnceInsteadOfEveryPlot() throws Exception {
		File file = csv("utm.csv", "id,YCoordinate,XCoordinate,elevation,slope,aspect", "u1,9857000,257000,0,0,0");
		Map<String, Object> answer = new SampleFileCheck(f -> result, () -> EXPECTED, () -> 1, () -> "EPSG:32737").check(file.getAbsolutePath());
		assertEquals(Arrays.asList("notWgs84Survey"), codes(answer));
		String message = (String) problems(answer).get(0).get("message");
		assertTrue(message.contains("EPSG:32737") && message.contains("EPSG:4326") && !message.contains("<br/>"), message);
		assertTrue(SampleFileCheck.isBlocking(answer));
		// a WGS84 one by any of its names, and plots in degrees: nothing said
		for (String wgs84 : new String[] { "", "LATLONG", "wgs84", "EPSG:4326" }) {
			File degrees = csv("degrees.csv", "id,YCoordinate,XCoordinate,elevation,slope,aspect", "a,-1.29,36.82,0,0,0");
			assertTrue(problems(new SampleFileCheck(f -> result, () -> EXPECTED, () -> 1, () -> wgs84).check(degrees.getAbsolutePath())).isEmpty(), wgs84);
		}
	}

	private static List<Object> codes(Map<String, Object> answer) {
		List<Object> codes = new ArrayList<>();
		for (Map<String, Object> problem : problems(answer)) {
			codes.add(problem.get("code"));
		}
		return codes;
	}
}
