package org.openforis.collect.earth.app.server;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.io.IOUtils;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService;
import org.openforis.collect.earth.app.service.AbstractEarthSurveyService.PlotStatus;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.PlotFileIndex;
import org.openforis.collect.earth.app.service.PlotGeoJsonBuilder;
import org.openforis.collect.earth.app.service.cloud.CorrectionService;
import org.openforis.collect.earth.app.service.cloud.TrainingPlotFiles;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.model.CollectRecord;
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
 * Serves the plots map and web form pages (classpath assets under /leafletmap, built from the React
 * project in src/main/frontend) and the JSON they read: /plotsIndex (every plot of the plot file, by its id, the label
 * the collector sees and its place: what the list and the next plot go by), /plotDetail (one plot with everything the
 * form needs, and the outlines of the plots around it, when it is opened), /plotsGeoJson (the plots asked for, with
 * their geometry and properties) and /plotStatuses (incremental id->status map for the live coloring, with a repeat
 * survey's period status of each plot).
 * <p>
 * No answer holds every plot's geometry: with its sample points a plot is some 8 KB of it, so 20,000 plots made a
 * 158 MB answer and 100,000 ran the server out of memory, while the collector only ever needs the plot open and its
 * neighbours. The index holds a plot's row of the plot file, which the others are made from when asked.
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

	/** The radius and the number of plots around the one opened whose outlines Google Earth Web draws */
	static final double NEIGHBOURS_RADIUS_METERS = 3000;
	static final int MAX_NEIGHBOURS = 300;
	/** The most plots /plotsGeoJson gives at once when asked for some (the ids are in its address) */
	static final int MAX_PLOTS_ASKED = 500;

	@Autowired
	private PlotFileIndex plotFileIndex;
	private final com.fasterxml.jackson.databind.ObjectMapper json = new com.fasterxml.jackson.databind.ObjectMapper();

	/** The files of the Vite build (see HttpCaching), read once from its manifest */
	private volatile Set<String> builtFiles;

	// ---------- static page ----------

	// The pages are asked for again each time (a 304 while unchanged), the files of the build named by their content kept
	// a year: see HttpCaching

	@GetMapping("/map")
	public void mapPage(HttpServletRequest request, HttpServletResponse response) throws IOException {
		serveClasspath("leafletmap/map.html", "text/html; charset=UTF-8", HttpCaching.REVALIDATE, request, response);
	}

	/** The data entry form generated from the survey (see SurveyFormController), shown next to the map. */
	@GetMapping("/form")
	public void formPage(HttpServletRequest request, HttpServletResponse response) throws IOException {
		serveClasspath("leafletmap/form.html", "text/html; charset=UTF-8", HttpCaching.REVALIDATE, request, response);
	}

	/** The Collect Earth logo and "pick the first plot", in the window of the other imagery before the first plot. */
	@GetMapping("/waiting")
	public void waitingPage(HttpServletRequest request, HttpServletResponse response) throws IOException {
		serveClasspath("leafletmap/waiting.html", "text/html; charset=UTF-8", HttpCaching.REVALIDATE, request, response);
	}

	@GetMapping("/map/assets/{folder}/{file:.+}")
	public void vendorAsset(@PathVariable String folder, @PathVariable String file, HttpServletRequest request,
			HttpServletResponse response) throws IOException {
		// not files of the build (it puts them all in the folder itself): asked for again
		serveClasspath("leafletmap/" + folder + "/" + file, contentType(file), HttpCaching.REVALIDATE, request, response);
	}

	@GetMapping("/map/assets/{file:.+}")
	public void asset(@PathVariable String file, HttpServletRequest request, HttpServletResponse response) throws IOException {
		serveClasspath("leafletmap/" + file, contentType(file), HttpCaching.cacheControlFor(file, builtFiles()), request,
				response);
	}

	private Set<String> builtFiles() {
		Set<String> files = builtFiles;
		if (files == null) {
			try (InputStream in = getClass().getClassLoader().getResourceAsStream("leafletmap/" + HttpCaching.MANIFEST)) {
				files = HttpCaching.builtFiles(in);
			} catch (IOException e) {
				files = Collections.emptySet();
			}
			builtFiles = files;
		}
		return files;
	}

	private String contentType(String file) {
		if (file.endsWith(".js")) return "application/javascript";
		if (file.endsWith(".css")) return "text/css";
		if (file.endsWith(".png")) return "image/png";
		if (file.endsWith(".svg")) return "image/svg+xml";
		if (file.endsWith(".woff2")) return "font/woff2";
		if (file.endsWith(".woff")) return "font/woff";
		if (file.endsWith(".html")) return "text/html; charset=UTF-8";
		return "application/octet-stream";
	}

	private void serveClasspath(String path, String contentType, String cacheControl, HttpServletRequest request,
			HttpServletResponse response) throws IOException {
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
			HttpCaching.send(request, response, IOUtils.toByteArray(in), contentType, cacheControl, null);
		}
	}

	/** The plots the person corrects, when they are the plots file (absent in some tests) */
	@Autowired(required = false)
	private CorrectionService corrections;

	// ---------- data endpoints ----------

	/**
	 * The plots of the plot file, in its order, as three lists of the same length: their ids (every key joined by ","),
	 * the labels the collector sees them by (the keys not hidden; null when it is the id) and their latitudes and
	 * longitudes. A few bytes a plot, whatever its shape: the list, the next plot to do and the neighbours go by it.
	 */
	@GetMapping("/plotsIndex")
	public void plotsIndex(HttpServletResponse response) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		String body;
		try {
			String csvFile = localPropertiesService.getCsvFile();
			String version = plotsVersion(csvFile);
			if (version.isEmpty()) {
				// No plot file yet: a valid, final state; the page says so instead of trying again forever
				body = "{\"plots\":\"\",\"ids\":[],\"labels\":[],\"latitudes\":[],\"longitudes\":[],\"warning\":\"No survey plot file loaded\"}";
			} else {
				body = withTraining(plotFileIndex.indexOf(csvFile).json, csvFile);
			}
		} catch (Exception e) {
			logger.error("Error reading the plot file for the plots map", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
			body = json.writeValueAsString(Collections.singletonMap("error", String.valueOf(e.getMessage())));
		}
		write(response, body);
	}

	/**
	 * One plot, when it is opened: its feature (the geometry with the sample points, and every column of its row, which
	 * the project's own balloon is filled with), and the outline of each plot within NEIGHBOURS_RADIUS_METERS, the
	 * nearest first, itself included, for Google Earth Web to draw around it. 404 for a plot not in the plot file.
	 */
	@GetMapping("/plotDetail")
	public void plotDetail(HttpServletResponse response, @RequestParam("id") String id) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		try {
			String csvFile = localPropertiesService.getCsvFile();
			String version = plotsVersion(csvFile);
			PlotFileIndex.PlotIndex index = version.isEmpty() ? null : plotFileIndex.indexOf(csvFile);
			Integer at = index == null ? null : index.position.get(id);
			if (at == null) {
				response.setStatus(HttpServletResponse.SC_NOT_FOUND);
				write(response, "{\"error\":\"not_found\"}");
				return;
			}
			KmlGenerator generator = index.generator;
			StringBuilder sb = new StringBuilder("{\"plots\":").append(json.writeValueAsString(version));
			sb.append(",\"feature\":").append(geoJsonBuilder.toFeature(fullPlot(generator, index, at)));
			sb.append(",\"near\":[");
			boolean first = true;
			for (int near : index.near(at, NEIGHBOURS_RADIUS_METERS, MAX_NEIGHBOURS)) {
				try {
					List<double[]> outline = PlotGeoJsonBuilder.outline(fullPlot(generator, index, near));
					if (outline == null) continue;
					Map<String, Object> plot = new LinkedHashMap<>();
					plot.put("id", index.ids[near]);
					plot.put("outline", outline);
					if (!first) sb.append(',');
					sb.append(json.writeValueAsString(plot));
					first = false;
				} catch (Exception rowError) {
					logger.debug("No outline for plot {}", index.ids[near]);
				}
			}
			write(response, sb.append("]}").toString());
		} catch (Exception e) {
			logger.error("Error reading the plot " + id, e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
			write(response, json.writeValueAsString(Collections.singletonMap("error", String.valueOf(e.getMessage()))));
		}
	}

	/**
	 * The plots asked for (`ids`, joined by "|": a plot id has commas), at most MAX_PLOTS_ASKED, as a GeoJSON
	 * FeatureCollection with their geometry and properties; without `ids` every plot, written as it is made (no answer
	 * kept in memory), for what still asks for them all.
	 */
	@GetMapping("/plotsGeoJson")
	public void plotsGeoJson(HttpServletResponse response, @RequestParam(value = "ids", required = false) String ids) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		String csvFile = localPropertiesService.getCsvFile();
		String version = plotsVersion(csvFile);
		if (version.isEmpty()) {
			write(response, "{\"plots\":\"\",\"type\":\"FeatureCollection\",\"features\":[],\"warning\":\"No survey plot file loaded\"}");
			return;
		}
		try {
			PlotFileIndex.PlotIndex index = plotFileIndex.indexOf(csvFile);
			KmlGenerator generator = index.generator;
			List<Integer> wanted = new java.util.ArrayList<>();
			if (ids == null) {
				for (int i = 0; i < index.ids.length; i++) wanted.add(i);
			} else {
				for (String id : ids.split("\\|", MAX_PLOTS_ASKED + 1)) {
					Integer at = index.position.get(id);
					if (at != null && wanted.size() < MAX_PLOTS_ASKED) wanted.add(at);
				}
			}
			java.io.OutputStream out = response.getOutputStream();
			out.write(("{\"plots\":" + json.writeValueAsString(version) + ",\"type\":\"FeatureCollection\",\"features\":[").getBytes(StandardCharsets.UTF_8));
			boolean first = true;
			for (int at : wanted) {
				String feature;
				try {
					feature = geoJsonBuilder.toFeature(fullPlot(generator, index, at));
				} catch (Exception rowError) {
					logger.debug("Skipping plot {}", index.ids[at]);
					continue;
				}
				out.write(((first ? "" : ",") + feature).getBytes(StandardCharsets.UTF_8));
				first = false;
			}
			out.write("]}".getBytes(StandardCharsets.UTF_8));
		} catch (IOException clientAbort) {
			// The browser navigated away while the answer was written - routine, not a server error
			logger.debug("Client aborted the plots GeoJSON download", clientAbort);
		} catch (Exception e) {
			logger.error("Error generating plots GeoJSON", e);
			if (!response.isCommitted()) {
				response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
				write(response, json.writeValueAsString(Collections.singletonMap("error", String.valueOf(e.getMessage()))));
			}
		}
	}

	private void write(HttpServletResponse response, String body) {
		try {
			response.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
		} catch (IOException clientAbort) {
			logger.debug("Client aborted the answer", clientAbort);
		}
	}

	/** A plot as the map draws it: its row made into the plot, with its sample points and its outline. */
	private SimplePlacemarkObject fullPlot(KmlGenerator generator, PlotFileIndex.PlotIndex index, int at) throws Exception {
		SimplePlacemarkObject plot = generator.getPlotObject(index.rows[at], index.header, earthSurveyService.getCollectSurvey(), false);
		generator.fillSamplePoints(plot);
		generator.fillExternalLine(plot);
		return plot;
	}

	/**
	 * The index, with {@code training}, the set's name, when the plots file is the training set the person opened, or
	 * {@code corrections} when it is their plots to correct (the list says so)
	 */
	private String withTraining(String index, String csvFile) throws IOException {
		if (!localPropertiesService.isCloudSyncEnabled()) {
			return index;
		}
		if (corrections != null && corrections.isOpen()) {
			return "{\"corrections\":true," + index.substring(1); //$NON-NLS-1$
		}
		String training = TrainingPlotFiles.trainingName(csvFile, localPropertiesService.getValue(EarthProperty.CLOUD_TRAINING_FILE));
		return training == null ? index : "{\"training\":" + json.writeValueAsString(training) + "," + index.substring(1); //$NON-NLS-1$
	}

	/**
	 * The plot file the plots map shows, and its version: its path, when it was last changed and its size, "" when there
	 * is none: no path, no such file, a folder, or a file with no plot in it (a cloud participant holding no plot yet,
	 * after a calibration say: its my-plots.csv is empty), which the plot file reader refuses and the map then showed as
	 * an error.
	 * The plots map loads its plots again when the statuses tell another one (settings applied, a plot file dropped, the
	 * cloud project's assigned file), as nothing reloads the panel of Google Earth Web.
	 */
	static String plotsVersion(String csvFile) {
		if (csvFile == null || csvFile.trim().isEmpty()) {
			return "";
		}
		File csv = new File(csvFile);
		return csv.isFile() && hasData(csv) ? csvFile + "@" + csv.lastModified() + ":" + csv.length() : "";
	}

	/** Whether a plot file has anything but blank lines; a file over a few kilobytes is taken to (it is not read) */
	private static boolean hasData(File csv) {
		final long length = csv.length();
		if (length == 0) {
			return false;
		}
		if (length > 4096) {
			return true;
		}
		try {
			return !new String(java.nio.file.Files.readAllBytes(csv.toPath()), StandardCharsets.UTF_8).trim().isEmpty();
		} catch (IOException e) {
			return true; // the reader then says what is wrong with it
		}
	}

	@GetMapping("/mapConfig")
	public void mapConfig(HttpServletResponse response) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		Map<String, Object> config = new LinkedHashMap<>();
		config.put("language", localPropertiesService.getUiLanguage().getLocale().getLanguage());
		config.put("webForm", localPropertiesService.getWebForm());
		json.writeValue(response.getOutputStream(), config);
	}

	/** The status as the plots map names it */
	static String statusName(PlotStatus status) {
		switch (status) {
		case SUBMITTED:
			return "saved";
		case IN_PROGRESS:
			return "partial";
		default:
			return "empty";
		}
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
			// (Google Earth Pro's icon refresh had the same overlap window.)
			long now = System.currentTimeMillis() - STATUS_CURSOR_OVERLAP_MILLIS;
			Map<String, String> statuses = new LinkedHashMap<>();
			// A repeat survey's: what the collector said of each plot against the earlier period ("" when not answered),
			// for the list and the map to show only the plots said changed, for instance
			boolean repeat = earthSurveyService.hasPeriodStatus();
			Map<String, String> periods = new LinkedHashMap<>();
			// Each status loads a whole record. A survey database holds records of many more plots than the
			// plot file on the map ( 17,968 for 15 plots ): loading all of them took minutes, and the polls
			// piled up until the browser had no connection left to load the page with
			String csvFile = localPropertiesService.getCsvFile();
			String version = plotsVersion(csvFile);
			Set<String> plotIds = !version.isEmpty() ? plotFileIndex.indexOf(csvFile).idSet : Collections.emptySet();
			// The plots to correct are no records of the local database (CorrectionService): their statuses are the
			// corrections', every time (a few plots), and a record of the person's with the same keys is not shown
			boolean correcting = corrections != null && corrections.isOpen();
			if (correcting) {
				statuses.putAll(corrections.statuses());
				statuses.keySet().retainAll(plotIds);
			}
			List<CollectRecordSummary> summaries = plotIds.isEmpty() || correcting ? null : earthSurveyService.getRecordSummariesSavedSince(since);
			if (summaries != null) {
				for (CollectRecordSummary summary : summaries) {
					List<String> keys = summary.getRootEntityKeyValues();
					if (keys == null || keys.isEmpty() || !plotIds.contains(String.join(",", keys))) continue;
					try {
						// a record with nothing answered (stored by opening the plot, before) is not started; loaded by the id of
						// its summary, not looked for again by its keys
						CollectRecord record = earthSurveyService.loadRecordOf(summary);
						statuses.put(String.join(",", keys), statusName(AbstractEarthSurveyService.getPlotStatus(record)));
						if (repeat) {
							String period = AbstractEarthSurveyService.getPeriodStatus(record);
							periods.put(String.join(",", keys), period == null ? "" : period);
						}
					} catch (Exception e) {
						logger.debug("Could not read status for {}", keys);
					}
				}
			}
			Map<String, Object> result = new LinkedHashMap<>();
			result.put("now", now);
			result.put("statuses", statuses);
			result.put("plots", version);
			if (corrections != null && localPropertiesService.isCloudSyncEnabled()) {
				// the list offers them while the person is on their own plots
				result.put("toCorrect", corrections.toCorrect());
			}
			if (repeat) {
				result.put("periods", periods);
			}
			json.writeValue(response.getOutputStream(), result);
		} catch (Exception e) {
			logger.error("Error generating plot statuses", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
		}
	}
}
