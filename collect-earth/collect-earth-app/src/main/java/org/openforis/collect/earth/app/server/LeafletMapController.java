package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
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

	/** Overlap window for the /plotStatuses incremental cursor; must exceed the
	 *  deferred-save flush delay (FLUSH_DEBOUNCE_MS + FLUSH_POLL_MS = 1.5s) with headroom. */
	private static final long STATUS_CURSOR_OVERLAP_MILLIS = 10_000L;

	private final Logger logger = LoggerFactory.getLogger(LeafletMapController.class);
	private final PlotGeoJsonBuilder geoJsonBuilder = new PlotGeoJsonBuilder();

	// /plotsGeoJson result cached against the CSV path + lastModified (guarded by
	// the synchronized builder method; volatile for the fast-path read).
	private volatile String cachedFeatureCollection;
	private volatile String cachedCsvPath;
	private volatile long cachedCsvLastModified;
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
		// {file:.+} DOES match across '/' (that is how vendor/images/*.png resolves),
		// so this '..' check is the actual traversal guard - do not remove it.
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
		String body;
		try {
			String csvFile = localPropertiesService.getCsvFile();
			if (csvFile == null || csvFile.trim().isEmpty() || !new File(csvFile).exists()) {
				// No survey plot file loaded yet: this is a valid, final state (not an error).
				// Return an empty FeatureCollection with a warning so the page shows a banner
				// instead of NPEing into a 500 and entering an endless retry loop.
				body = "{\"type\":\"FeatureCollection\",\"features\":[],\"warning\":\"No survey plot file loaded\"}";
			} else {
				body = getOrBuildFeatureCollection(csvFile);
			}
		} catch (Exception e) {
			logger.error("Error generating plots GeoJSON", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
			body = "{\"error\":\"" + e.getMessage() + "\"}";
		}
		try {
			response.getOutputStream().write(body.getBytes("UTF-8"));
		} catch (IOException clientAbort) {
			// The browser navigated away / reloaded while the (potentially large)
			// response was streaming - routine, not a server error.
			logger.debug("Client aborted the plots GeoJSON download", clientAbort);
		}
	}

	/**
	 * Builds the FeatureCollection, cached against the CSV file path + lastModified
	 * so page reloads and racing startup requests do not redo the per-plot
	 * coordinate transforms for the whole grid. Synchronized: concurrent first
	 * requests would otherwise each rebuild the full collection.
	 */
	private synchronized String getOrBuildFeatureCollection(String csvFile) throws Exception {
		File csv = new File(csvFile);
		if (cachedFeatureCollection != null && csvFile.equals(cachedCsvPath)
				&& csv.lastModified() == cachedCsvLastModified) {
			return cachedFeatureCollection;
		}
		KmlGenerator kmlGenerator = kmlGeneratorService.getKmlGenerator();
		StringBuilder sb = new StringBuilder("{\"type\":\"FeatureCollection\",\"features\":[");
		boolean first = true;
		try (CSVReader reader = CsvReaderUtils.getCsvReader(csvFile)) {
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
		cachedCsvPath = csvFile;
		cachedCsvLastModified = csv.lastModified();
		cachedFeatureCollection = sb.toString();
		return cachedFeatureCollection;
	}

	@GetMapping("/plotStatuses")
	public void plotStatuses(HttpServletResponse response,
			@RequestParam(value = "since", required = false) Long sinceMillis) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		try {
			Date since = sinceMillis == null ? new Date(0) : new Date(sinceMillis);
			// The next-poll cursor must lag behind the wall clock: records saved through
			// the deferred/write-behind path get their modifiedDate stamped up to ~1.5s
			// before the DB write lands, so an exact "now" cursor would skip them forever.
			// Same overlap-window pattern as PlacemarkUpdateServlet.getTwoMinutesAgo().
			long now = System.currentTimeMillis() - STATUS_CURSOR_OVERLAP_MILLIS;
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
