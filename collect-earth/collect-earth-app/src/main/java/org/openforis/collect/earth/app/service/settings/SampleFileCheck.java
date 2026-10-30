package org.openforis.collect.earth.app.service.settings;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.io.metadata.collectearth.CSVFileValidationResult;
import org.openforis.collect.io.metadata.collectearth.CSVRowValidationResult;
import org.openforis.collect.io.metadata.collectearth.CollectEarthGridTemplateGenerator;
import org.openforis.collect.manager.validation.SurveyValidator.ValidationParameters;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.opencsv.CSVReader;

/**
 * What the settings page shows about the plots file the user picked, before it is applied: how many plots it has,
 * its columns against the ones the survey expects, its first rows and where its plots are, and what is wrong with it.
 * The Swing dialog did the same in a table (JPlotCsvTable), with a modal dialog per problem.
 * <p>
 * A blocking problem keeps the settings from being applied, as the dialog disabled its button: a file that is not a
 * CSV, or whose values are wrong. The others, as there, are only shown.
 */
@Service
public class SampleFileCheck {

	/** How many rows the page shows */
	public static final int PREVIEW_ROWS = 20;
	/** How many plots the map of the page draws */
	public static final int MAX_POINTS = 5000;

	private final Logger logger = LoggerFactory.getLogger(SampleFileCheck.class);
	/** The check of Collect against the survey, or null when there is no survey to check against */
	private final Function<File, CSVFileValidationResult> validator;
	private final Supplier<List<String>> expectedHeaders;

	@Autowired
	public SampleFileCheck(EarthSurveyService surveys) {
		this(file -> {
			CollectSurvey survey = surveys.getCollectSurvey();
			if (survey == null) {
				return null;
			}
			ValidationParameters parameters = new ValidationParameters();
			parameters.setValidateOnlyFirstLines(false);
			return new CollectEarthGridTemplateGenerator().validate(file, survey, parameters);
		}, () -> {
			CollectSurvey survey = surveys.getCollectSurvey();
			return survey == null ? Collections.emptyList() : new CollectEarthGridTemplateGenerator().getExpectedHeaders(survey);
		});
	}

	/** For the tests: the check of Collect and the expected headers stood in for. */
	public SampleFileCheck(Function<File, CSVFileValidationResult> validator, Supplier<List<String>> expectedHeaders) {
		this.validator = validator;
		this.expectedHeaders = expectedHeaders;
	}

	/**
	 * @return {@code {exists, plots, expectedColumns, foundColumns, rows, points, problems: [{code, message, blocking,
	 *         details}]}}: the rows are the first PREVIEW_ROWS, the points the (latitude, longitude) of the first
	 *         MAX_POINTS plots, the found columns the header row when the file has one
	 */
	public Map<String, Object> check(String path) {
		Map<String, Object> answer = new LinkedHashMap<>();
		List<Map<String, Object>> problems = new ArrayList<>();
		File file = new File(StringUtils.trimToEmpty(path));
		boolean exists = !path.trim().isEmpty() && file.isFile();
		answer.put("exists", exists);
		answer.put("expectedColumns", expectedHeaders.get());
		if (!exists) {
			problems.add(problem("missing", Messages.getString("SettingsPage.sampleFile.missing"), true, null));
			answer.put("plots", 0);
			answer.put("foundColumns", Collections.emptyList());
			answer.put("rows", Collections.emptyList());
			answer.put("points", Collections.emptyList());
			answer.put("problems", problems);
			return answer;
		}
		read(file, answer, problems);
		CSVFileValidationResult validation = null;
		try {
			validation = validator.apply(file);
		} catch (RuntimeException e) {
			logger.error("The plots file could not be checked against the survey: " + file, e);
		}
		if (validation != null && !validation.isSuccessful()) {
			problems.add(problemOf(validation));
		}
		answer.put("problems", problems);
		return answer;
	}

	/** The rows, the points and the header; a file the CSV reader cannot read as one is a blocking problem. */
	private void read(File file, Map<String, Object> answer, List<Map<String, Object>> problems) {
		List<String> foundColumns = Collections.emptyList();
		List<List<String>> rows = new ArrayList<>();
		List<List<Double>> points = new ArrayList<>();
		int plots = 0;
		try (CSVReader reader = CsvReaderUtils.getCsvReader(file.getAbsolutePath())) {
			String[] line;
			boolean first = true;
			while ((line = reader.readNext()) != null) {
				if (CsvReaderUtils.onlyEmptyCells(line)) {
					continue;
				}
				if (first && isHeader(line)) {
					foundColumns = Arrays.asList(line);
					first = false;
					continue;
				}
				first = false;
				plots++;
				if (rows.size() < PREVIEW_ROWS) {
					rows.add(Arrays.asList(line));
				}
				if (points.size() < MAX_POINTS && line.length > 2) {
					Double latitude = number(line[1]);
					Double longitude = number(line[2]);
					if (latitude != null && longitude != null) {
						points.add(Arrays.asList(latitude, longitude));
					}
				}
			}
		} catch (IllegalArgumentException e) {
			// CsvReaderUtils found no separator that gives the columns of a plot: not a plots file
			problems.add(problem("INVALID_FILE_TYPE", Messages.getString("JPlotCsvTable.expectedFileType"), true, null));
		} catch (Exception e) {
			logger.error("The plots file could not be read: " + file, e);
			problems.add(problem("unreadable", Messages.getString("JPlotCsvTable.expectedFileType"), true, e.getMessage()));
		}
		if (plots == 0 && problems.isEmpty()) {
			problems.add(problem("noRows", Messages.getString("JPlotCsvTable.noPlotInfo"), false, null));
		}
		answer.put("plots", plots);
		answer.put("foundColumns", foundColumns);
		answer.put("rows", rows);
		answer.put("points", points);
	}

	/** A first row whose latitude or longitude is not a number is the header, whatever its first cell says. */
	private static boolean isHeader(String[] line) {
		return line.length > 2 && (number(line[1]) == null || number(line[2]) == null);
	}

	private static Double number(String cell) {
		try {
			return Double.valueOf(cell.trim());
		} catch (NumberFormatException e) {
			return null;
		}
	}

	/** The problem Collect found, said as JPlotCsvTable said it, blocking when it kept the dialog from applying. */
	private static Map<String, Object> problemOf(CSVFileValidationResult validation) {
		String code = validation.getErrorType().name();
		switch (validation.getErrorType()) {
		case INVALID_FILE_TYPE:
		case INVALID_NUMBER_OF_COLUMNS:
			return problem(code, Messages.getString("JPlotCsvTable.expectedFileType"), true, null);
		case INVALID_HEADERS:
			return problem(code, String.format(Messages.getString("JPlotCsvTable.expectedColumns"), validation.getExpectedHeaders()), false, null);
		case INVALID_NUMBER_OF_PLOTS_TOO_LARGE:
			return problem(code, String.format(Messages.getString("JPlotCsvTable.tooLargeError"), validation.getNumberOfRows()), false, null);
		case INVALID_NUMBER_OF_PLOTS_WARNING:
			return problem(code, String.format(Messages.getString("JPlotCsvTable.tooLargeWarning"), validation.getNumberOfRows()), false, null);
		case INVALID_VALUES_IN_CSV:
			return problem(code, Messages.getString("JPlotCsvTable.contentIncorrect"), true, rowsOf(validation));
		default:
			return problem(code, StringUtils.defaultIfBlank(validation.getMessage(), code), false, null);
		}
	}

	/** Which cells are wrong, for the page to mark them in the rows it shows: {row, column, message}, row and column from 1. */
	private static List<Map<String, Object>> rowsOf(CSVFileValidationResult validation) {
		List<Map<String, Object>> cells = new ArrayList<>();
		if (validation.getRowValidations() == null) {
			return cells;
		}
		for (CSVRowValidationResult row : validation.getRowValidations()) {
			Map<String, Object> cell = new LinkedHashMap<>();
			cell.put("row", row.getRowNumber());
			cell.put("column", row.getColumnPosition());
			cell.put("message", row.getMessage());
			cells.add(cell);
		}
		return cells;
	}

	private static Map<String, Object> problem(String code, String message, boolean blocking, Object details) {
		Map<String, Object> problem = new LinkedHashMap<>();
		problem.put("code", code);
		problem.put("message", message);
		problem.put("blocking", blocking);
		problem.put("details", details);
		return problem;
	}

	/** Whether a problem that keeps the settings from being applied was found. */
	@SuppressWarnings("unchecked")
	public static boolean isBlocking(Map<String, Object> check) {
		for (Map<String, Object> problem : (List<Map<String, Object>>) check.get("problems")) {
			if (Boolean.TRUE.equals(problem.get("blocking"))) {
				return true;
			}
		}
		return false;
	}
}
