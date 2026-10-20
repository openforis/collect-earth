package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.servlet.http.HttpServletResponse;

import org.apache.commons.text.StringEscapeUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.SurveyFormModelBuilder;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.opencsv.CSVReader;

/**
 * The two JSON endpoints of the web form that is generated from the survey (form.html in
 * src/main/frontend, served at /earth/form):
 * <ul>
 * <li>/surveyForm: the form layout, fields and code lists ({@link SurveyFormModelBuilder}), in the
 * Collect Earth UI language;</li>
 * <li>/surveyForm/plot?id=...: the values the form sends with every save that come from the plot file
 * rather than from the operator - the keys, the "from CSV" attributes, the location and the plot file.
 * Google Earth gets the same values from the KML ($[EXTRA_...]).</li>
 * </ul>
 * The data itself is loaded and saved through the endpoints the balloon uses (placemark-info-expanded,
 * save-data-expanded, create-entity, delete-entity).
 */
@Controller
public class SurveyFormController {

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private KmlGeneratorService kmlGeneratorService;

	private final Logger logger = LoggerFactory.getLogger(SurveyFormController.class);
	private final ObjectMapper json = new ObjectMapper();

	// The model only changes with the survey, the language or the model version
	private CollectSurvey cachedSurvey;
	private String cachedModelKey;
	private Map<String, Object> cachedModel;

	// Plot file values by placemark id: the location, then the extra columns. Rebuilt when the file changes.
	private String cachedCsvPath;
	private long cachedCsvLastModified;
	private Map<String, String[]> plotsById;

	@GetMapping("/surveyForm")
	public void surveyForm(HttpServletResponse response) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		response.setHeader("Cache-Control", "no-store");
		try {
			json.writeValue(response.getOutputStream(), getModel());
		} catch (Exception e) {
			logger.error("Error generating the survey form", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
			json.writeValue(response.getOutputStream(), errorBody(e));
		}
	}

	private synchronized Map<String, Object> getModel() {
		CollectSurvey survey = earthSurveyService.getCollectSurvey();
		if (survey == null) {
			throw new IllegalStateException("No survey loaded");
		}
		String language = localPropertiesService.getUiLanguage().getLocale().getLanguage();
		String version = localPropertiesService.getModelVersionName();
		String key = language + "|" + version;
		if (survey != cachedSurvey || !key.equals(cachedModelKey)) {
			cachedModel = new SurveyFormModelBuilder(survey, language, version).build();
			cachedSurvey = survey;
			cachedModelKey = key;
		}
		return cachedModel;
	}

	@GetMapping("/surveyForm/plot")
	public void plotValues(@RequestParam("id") String placemarkId, HttpServletResponse response) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		response.setHeader("Cache-Control", "no-store");
		try {
			Map<String, Object> result = new LinkedHashMap<>();
			result.put("id", placemarkId);
			result.put("values", plotValues(placemarkId));
			json.writeValue(response.getOutputStream(), result);
		} catch (Exception e) {
			logger.error("Error reading the plot file values of plot " + placemarkId, e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
			json.writeValue(response.getOutputStream(), errorBody(e));
		}
	}

	@SuppressWarnings("unchecked")
	private Map<String, String> plotValues(String placemarkId) throws Exception {
		Map<String, Object> model = getModel();
		List<String> keys = (List<String>) model.get("keys");
		List<String> csvFields = (List<String>) model.get("csvFields");
		Map<String, String> values = new LinkedHashMap<>();

		// The keys are the plot id itself, as the KML builds it (KmlGenerator.getPlotObject)
		String[] keyValues = placemarkId.split(",", -1);
		for (int i = 0; i < keys.size() && i < keyValues.length; i++) {
			values.put(keys.get(i), keyValues[i]);
		}
		String[] plot = getPlotsById().get(placemarkId);
		if (plot != null) {
			if (plot[0] != null) {
				values.put("collect_coord_location", plot[0]);
			}
			// the i-th extra column holds the value of the i-th "from CSV" attribute, as in the KML template
			for (int i = 0; i < csvFields.size() && i + 1 < plot.length; i++) {
				values.put(csvFields.get(i), plot[i + 1]);
			}
		}
		String csvFile = localPropertiesService.getCsvFile();
		if (csvFile != null) {
			values.put("collect_text_plot_file", csvFile);
		}
		return values;
	}

	private synchronized Map<String, String[]> getPlotsById() throws Exception {
		String csvFile = localPropertiesService.getCsvFile();
		if (csvFile == null || !new File(csvFile).exists()) {
			return new HashMap<>();
		}
		File csv = new File(csvFile);
		if (plotsById != null && csvFile.equals(cachedCsvPath) && csv.lastModified() == cachedCsvLastModified) {
			return plotsById;
		}
		KmlGenerator kmlGenerator = kmlGeneratorService.getKmlGenerator();
		CollectSurvey survey = earthSurveyService.getCollectSurvey();
		Map<String, String[]> result = new HashMap<>();
		try (CSVReader reader = CsvReaderUtils.getCsvReader(csvFile)) {
			String[] csvRow;
			while ((csvRow = reader.readNext()) != null) {
				try {
					SimplePlacemarkObject plot = kmlGenerator.getPlotObject(csvRow, null, survey, false);
					String[] extraColumns = plot.getExtraColumns() == null ? new String[0] : plot.getExtraColumns();
					String[] values = new String[extraColumns.length + 1];
					values[0] = plot.getCoord() == null ? null
							: plot.getCoord().getLatitude() + "," + plot.getCoord().getLongitude();
					for (int i = 0; i < extraColumns.length; i++) {
						// getPlotObject escapes them for the KML
						values[i + 1] = StringEscapeUtils.unescapeXml(extraColumns[i]);
					}
					result.put(plot.getPlacemarkId(), values);
				} catch (Exception rowError) {
					// header row or malformed row - skipped, as in the KML generation
					logger.debug("Skipping CSV row: {}", (Object) csvRow);
				}
			}
		}
		plotsById = result;
		cachedCsvPath = csvFile;
		cachedCsvLastModified = csv.lastModified();
		return plotsById;
	}

	private static Map<String, Object> errorBody(Exception e) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("error", String.valueOf(e.getMessage()));
		return body;
	}
}
