package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.text.StringEscapeUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.PlotFileIndex;
import org.openforis.collect.earth.app.service.cloud.MyPlotsService;
import org.openforis.collect.earth.app.service.SurveyFormModelBuilder;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import com.fasterxml.jackson.databind.ObjectMapper;

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
	private PlotFileIndex plotFileIndex;

	/** In a cloud project, the plot file each of the person's plots comes from (absent in some tests) */
	@Autowired(required = false)
	private MyPlotsService myPlots;

	private final Logger logger = LoggerFactory.getLogger(SurveyFormController.class);
	private final ObjectMapper json = new ObjectMapper();

	// The model only changes with the survey, the language or the model version
	private CollectSurvey cachedSurvey;
	private String cachedModelKey;
	private Map<String, Object> cachedModel;
	// ... and so does its JSON, sent with its ETag: the form, loaded for every plot, gets a 304 while it has not changed
	private Map<String, Object> cachedJsonModel;
	private byte[] cachedJson;
	private String cachedEtag;

	/**
	 * The form of the survey. It does not depend on the plot or its record (they come from /surveyForm/plot and
	 * placemark-info-expanded), only on the survey, the language and the model version: the browser asks for it again for
	 * every plot, with the ETag it has, and gets a 304 while none of them changed.
	 */
	@GetMapping("/surveyForm")
	public void surveyForm(HttpServletRequest request, HttpServletResponse response) throws IOException {
		try {
			byte[] body;
			String etag;
			synchronized (this) {
				Map<String, Object> model = getModel();
				if (model != cachedJsonModel) {
					cachedJson = json.writeValueAsBytes(model);
					cachedEtag = HttpCaching.etag(cachedJson);
					cachedJsonModel = model;
				}
				body = cachedJson;
				etag = cachedEtag;
			}
			HttpCaching.send(request, response, body, "application/json; charset=UTF-8", HttpCaching.REVALIDATE, etag);
		} catch (Exception e) {
			response.setHeader("Content-Type", "application/json; charset=UTF-8");
			response.setHeader("Cache-Control", "no-store");
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
		String[] plot = plotRowValues(placemarkId);
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
		// The person's plots of a cloud project are one file: each plot keeps the name of the plot file it comes from
		String source = myPlots == null ? null : myPlots.plotFileOf(placemarkId);
		if (source != null) {
			values.put("collect_text_plot_file", source);
		} else if (csvFile != null) {
			values.put("collect_text_plot_file", csvFile);
		}
		return values;
	}

	/**
	 * The plot's place ("latitude,longitude") then its values of the "from CSV" attributes, from its row of the plot
	 * file (the index the plots map reads too: PlotFileIndex); null for a plot not in the plot file.
	 */
	private String[] plotRowValues(String placemarkId) throws Exception {
		String csvFile = localPropertiesService.getCsvFile();
		if (csvFile == null || !new File(csvFile).exists()) {
			return null;
		}
		PlotFileIndex.PlotIndex index = plotFileIndex.indexOf(csvFile);
		Integer at = index.position.get(placemarkId);
		if (at == null) {
			return null;
		}
		SimplePlacemarkObject plot = index.generator.getPlotObject(index.rows[at], null, earthSurveyService.getCollectSurvey(), false);
		String[] extraColumns = plot.getExtraColumns() == null ? new String[0] : plot.getExtraColumns();
		String[] values = new String[extraColumns.length + 1];
		values[0] = plot.getCoord() == null ? null : plot.getCoord().getLatitude() + "," + plot.getCoord().getLongitude();
		for (int i = 0; i < extraColumns.length; i++) {
			// getPlotObject escapes them for the KML
			values[i + 1] = StringEscapeUtils.unescapeXml(extraColumns[i]);
		}
		return values;
	}

	private static Map<String, Object> errorBody(Exception e) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("error", String.valueOf(e.getMessage()));
		return body;
	}
}
