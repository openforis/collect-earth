package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.servlet.http.HttpServletResponse;

import org.apache.commons.io.IOUtils;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.PlotGeoJsonBuilder;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.model.CollectRecordSummary;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;

import com.opencsv.CSVReader;

/**
 * Serves the Leaflet map page (classpath assets under /leafletmap) and the two
 * JSON endpoints it consumes: /plotsGeoJson (all plot geometries+properties)
 * and /plotStatuses (incremental id->status map for the live coloring).
 */
@Controller
public class LeafletMapController {

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private KmlGeneratorService kmlGeneratorService;

	private final Logger logger = LoggerFactory.getLogger(LeafletMapController.class);
	private final PlotGeoJsonBuilder geoJsonBuilder = new PlotGeoJsonBuilder();
	private final com.fasterxml.jackson.databind.ObjectMapper json = new com.fasterxml.jackson.databind.ObjectMapper();

	// ---------- static page ----------

	@GetMapping("/map")
	public void mapPage(HttpServletResponse response) throws IOException {
		serveClasspath("leafletmap/map.html", "text/html; charset=UTF-8", response);
	}

	@GetMapping("/map/assets/{folder}/{file:.+}")
	public void vendorAsset(@PathVariable String folder, @PathVariable String file, HttpServletResponse response)
			throws IOException {
		serveClasspath("leafletmap/" + folder + "/" + file, contentType(file), response);
	}

	@GetMapping("/map/assets/{file:.+}")
	public void asset(@PathVariable String file, HttpServletResponse response) throws IOException {
		serveClasspath("leafletmap/" + file, contentType(file), response);
	}

	private String contentType(String file) {
		if (file.endsWith(".js")) return "application/javascript";
		if (file.endsWith(".css")) return "text/css";
		if (file.endsWith(".png")) return "image/png";
		if (file.endsWith(".html")) return "text/html; charset=UTF-8";
		return "application/octet-stream";
	}

	private void serveClasspath(String path, String contentType, HttpServletResponse response) throws IOException {
		// {file:.+} path variables cannot contain '/', so traversal is not possible; belt and braces:
		if (path.contains("..")) {
			response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
			return;
		}
		try (InputStream in = getClass().getClassLoader().getResourceAsStream(path)) {
			if (in == null) {
				response.setStatus(HttpServletResponse.SC_NOT_FOUND);
				return;
			}
			response.setHeader("Content-Type", contentType);
			IOUtils.copy(in, response.getOutputStream());
		}
	}

	// ---------- data endpoints ----------

	@GetMapping("/plotsGeoJson")
	public void plotsGeoJson(HttpServletResponse response) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		try {
			KmlGenerator kmlGenerator = kmlGeneratorService.getKmlGenerator();
			StringBuilder sb = new StringBuilder("{\"type\":\"FeatureCollection\",\"features\":[");
			boolean first = true;
			try (CSVReader reader = CsvReaderUtils.getCsvReader(localPropertiesService.getCsvFile())) {
				String[] csvRow;
				while ((csvRow = reader.readNext()) != null) {
					try {
						SimplePlacemarkObject plot = kmlGenerator.getPlotObject(csvRow, null,
								earthSurveyService.getCollectSurvey(), false);
						kmlGenerator.fillSamplePoints(plot);
						kmlGenerator.fillExternalLine(plot);
						if (!first) sb.append(',');
						sb.append(geoJsonBuilder.toFeature(plot));
						first = false;
					} catch (Exception rowError) {
						// header row or malformed row - skip (same tolerance as the KML generation)
						logger.debug("Skipping CSV row: {}", (Object) csvRow);
					}
				}
			}
			sb.append("]}");
			response.getOutputStream().write(sb.toString().getBytes("UTF-8"));
		} catch (Exception e) {
			logger.error("Error generating plots GeoJSON", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
			response.getOutputStream().write(("{\"error\":\"" + e.getMessage() + "\"}").getBytes("UTF-8"));
		}
	}

	@GetMapping("/plotStatuses")
	public void plotStatuses(HttpServletResponse response,
			@RequestParam(value = "since", required = false) Long sinceMillis) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		try {
			Date since = sinceMillis == null ? new Date(0) : new Date(sinceMillis);
			long now = System.currentTimeMillis();
			Map<String, String> statuses = new LinkedHashMap<>();
			List<CollectRecordSummary> summaries = earthSurveyService.getRecordSummariesSavedSince(since);
			if (summaries != null) {
				for (CollectRecordSummary summary : summaries) {
					List<String> keys = summary.getRootEntityKeyValues();
					if (keys == null || keys.isEmpty()) continue;
					String[] keyArray = keys.toArray(new String[0]);
					try {
						Map<String, String> placemark = earthSurveyService.getPlacemark(keyArray, false);
						String status = "partial";
						if (earthSurveyService.isPlacemarkSavedActively(placemark)) {
							status = "saved";
						} else if (!earthSurveyService.isPlacemarkEdited(placemark)) {
							status = "empty";
						}
						statuses.put(String.join(",", keys), status);
					} catch (Exception e) {
						logger.debug("Could not read status for {}", keys);
					}
				}
			}
			Map<String, Object> result = new LinkedHashMap<>();
			result.put("now", now);
			result.put("statuses", statuses);
			json.writeValue(response.getOutputStream(), result);
		} catch (Exception e) {
			logger.error("Error generating plot statuses", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
		}
	}
}
