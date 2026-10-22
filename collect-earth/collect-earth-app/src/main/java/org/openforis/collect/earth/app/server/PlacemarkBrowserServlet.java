package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import javax.annotation.PreDestroy;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.GoogleEarthWebService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.WindowLayoutService;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;

import com.fasterxml.jackson.databind.ObjectMapper;

import com.opencsv.CSVReader;

/**
 * Servlet to return the information that is stored in Collect Earth for one
 * placemark (plot)
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Controller
public class PlacemarkBrowserServlet {
	@Autowired
	private BrowserService browserService;

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private GoogleEarthWebService googleEarthWebService;


	@Autowired

	private WindowLayoutService windowLayoutService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private KmlGeneratorService kmlGeneratorService;

	private volatile KmlGenerator kmlGenerator;

	private final AtomicReference<SimplePlacemarkObject> lastPlacemark = new AtomicReference<>();

	private final Logger logger = LoggerFactory.getLogger( PlacemarkBrowserServlet.class );

	private final ExecutorService executor = Executors.newCachedThreadPool();

	@PreDestroy
	public void shutdown() {
		executor.shutdownNow();
	}

	private final class OpenBrowserThread extends Thread {

		private final SimplePlacemarkObject placemarkObject;

		private OpenBrowserThread(String name, SimplePlacemarkObject placemarkObject) {
			super(name);
			this.placemarkObject = placemarkObject;
		}

		@Override
		public void run() {
			// If this is the first plot or the plot is different from the last one opened
			SimplePlacemarkObject previous = lastPlacemark.get();
			if (!Objects.equals(previous, placemarkObject)) {

				try {
					kmlGenerator.fillSamplePoints(placemarkObject);
					kmlGenerator.fillExternalLine(placemarkObject);

					openWindowAsync("Earth Engine APP", () -> browserService.openGEEAppURL(placemarkObject));
					openWindowAsync("Earth Map", () -> browserService.openEarthMapURL(placemarkObject));
					openWindowAsync("ESRI Wayback", () -> browserService.openEsriWayback(placemarkObject));
					openWindowAsync("Google Earth Web", () -> googleEarthWebService.showPlot(placemarkObject));
					openWindowAsync("Extra Map", () -> browserService.openExtraMap(placemarkObject));
					openWindowAsync("Street View", () -> browserService.openStreetView(placemarkObject));
					openWindowAsync("Planet Maps", () -> browserService.openPlanetMaps(placemarkObject));
					openWindowAsync("SecureWatch", () -> browserService.openSecureWatch(placemarkObject));

				} catch (TransformException | KmlGenerationException e) {
					logger.error("Error generating polygon", e);
				}
			}

			lastPlacemark.set(placemarkObject);
		}
	}

	@FunctionalInterface
	private interface BrowserAction {
		void execute() throws Exception;
	}

	private void openWindowAsync(String windowName, BrowserAction action) {
		executor.submit(() -> {
			try {
				action.execute();
			} catch (Exception e) {
				logger.error("Exception opening " + windowName + " window", e);
			}
		});
	}


	/*
	 * Opens the extra browser windows for Earth Engine, Earth Map and others. (non-Javadoc)
	 *
	 * @see
	 * org.openforis.collect.earth.app.server.JsonPocessorServlet#processRequest
	 * (javax.servlet.http.HttpServletRequest,
	 * javax.servlet.http.HttpServletResponse)
	 */
	@GetMapping(path = "/openAuxiliaryWindows")
	public void openAuxiliaryWindows(
			HttpServletResponse response,
			@RequestParam(value = "latLongCoordinates", required = false) final String latLongCoordinates,
			@RequestParam(value = "plotId", required = false) final String plotId)
	{
		if (latLongCoordinates == null || latLongCoordinates.isEmpty()) {
			response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
			return;
		}

		try {
			kmlGenerator = kmlGeneratorService.getKmlGenerator();
			SimplePlacemarkObject placemarkObject = new SimplePlacemarkObject(latLongCoordinates.split(","));
			if (plotId != null && !plotId.isEmpty()) {
				// The coordinates-only constructor leaves placemarkId null; integrations
				// like the GEE App URL require it (see BrowserService.openGEEAppURL).
				placemarkObject.setPlacemarkId(plotId);
			}
			OpenBrowserThread browserThread = new OpenBrowserThread("Open auxiliary windows " + latLongCoordinates, placemarkObject);
			browserThread.start();
			response.setStatus(HttpServletResponse.SC_OK);
		} catch (Exception e) {
			logger.error("Error loading browsers", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
		}
	}

	// ---------- Google Earth Web (plot viewer "Plots map + Google Earth Web") ----------

	/** What the Google Earth Web window is doing, shown in the plots map. */
	@GetMapping(path = "/googleEarthWeb/status")
	public void googleEarthWebStatus(HttpServletResponse response) throws IOException {
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		new ObjectMapper().writeValue(response.getOutputStream(), googleEarthWebService.getStatus());
	}

	/**
	 * Shows the plot in Google Earth Web even if it is the plot opened last (unlike
	 * /openAuxiliaryWindows): used to reopen a closed window or re-sync it.
	 */
	@GetMapping(path = "/googleEarthWeb/show")
	public void showInGoogleEarthWeb(HttpServletResponse response,
			@RequestParam("latLongCoordinates") String latLongCoordinates,
			@RequestParam("plotId") String plotId) {
		try {
			kmlGenerator = kmlGeneratorService.getKmlGenerator();
			SimplePlacemarkObject placemarkObject = new SimplePlacemarkObject(latLongCoordinates.split(","));
			placemarkObject.setPlacemarkId(plotId);
			executor.submit(() -> {
				try {
					kmlGenerator.fillSamplePoints(placemarkObject);
					kmlGenerator.fillExternalLine(placemarkObject);
					googleEarthWebService.showPlot(placemarkObject);
				} catch (Exception e) {
					logger.error("Error showing the plot in Google Earth Web", e);
				}
			});
			response.setStatus(HttpServletResponse.SC_OK);
		} catch (Exception e) {
			logger.error("Error showing the plot in Google Earth Web", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
		}
	}

	/** Opens Google Earth Web over the survey area before a plot is selected (no-op if open). */
	@GetMapping(path = "/googleEarthWeb/open")
	public void openGoogleEarthWeb(HttpServletResponse response,
			@RequestParam("latLongCoordinates") String latLongCoordinates) {
		SimplePlacemarkObject center = new SimplePlacemarkObject(latLongCoordinates.split(","));
		executor.submit(() -> googleEarthWebService.openOverview(center));
		response.setStatus(HttpServletResponse.SC_OK);
	}

	/**
	 * Neighbouring plots to draw around the plot shown in Google Earth Web, sent by the plots
	 * map: {"plotId": "...", "plots": [{"id": "...", "status": "saved", "rings": [[[lon, lat], ...]]}]}.
	 * The JSON is embedded in the script run in the Google Earth Web page, so it is rebuilt
	 * from typed values here instead of being passed through.
	 */
	@PostMapping(path = "/googleEarthWeb/context")
	public void googleEarthWebContext(HttpServletResponse response, @RequestBody String body) {
		try {
			ObjectMapper json = new ObjectMapper();
			Map<?, ?> request = json.readValue(body, Map.class);
			List<Map<String, Object>> plots = new ArrayList<>();
			Object requested = request.get("plots");
			if (requested instanceof List) {
				for (Object item : (List<?>) requested) {
					if (plots.size() >= MAX_CONTEXT_PLOTS) {
						break;
					}
					Map<String, Object> plot = sanitizeContextPlot(item);
					if (plot != null) {
						plots.add(plot);
					}
				}
			}
			Object plotId = request.get("plotId");
			googleEarthWebService.setContext(plotId == null ? null : String.valueOf(plotId), json.writeValueAsString(plots));
			response.setStatus(HttpServletResponse.SC_OK);
		} catch (Exception e) {
			logger.warn("Invalid Google Earth Web context", e);
			response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
		}
	}

	private static final int MAX_CONTEXT_PLOTS = 300;
	private static final List<String> CONTEXT_STATUSES = Arrays.asList("empty", "partial", "saved");

	private static Map<String, Object> sanitizeContextPlot(Object item) {
		if (!(item instanceof Map)) {
			return null;
		}
		Map<?, ?> source = (Map<?, ?>) item;
		Object status = source.get("status");
		List<List<double[]>> rings = new ArrayList<>();
		if (source.get("rings") instanceof List) {
			for (Object ring : (List<?>) source.get("rings")) {
				List<double[]> points = new ArrayList<>();
				if (ring instanceof List) {
					for (Object point : (List<?>) ring) {
						if (point instanceof List && ((List<?>) point).size() >= 2
								&& ((List<?>) point).get(0) instanceof Number && ((List<?>) point).get(1) instanceof Number) {
							points.add(new double[] { ((Number) ((List<?>) point).get(0)).doubleValue(),
									((Number) ((List<?>) point).get(1)).doubleValue() });
						}
					}
				}
				if (points.size() >= 3) {
					rings.add(points);
				}
			}
		}
		if (source.get("id") == null || rings.isEmpty()) {
			return null;
		}
		Map<String, Object> plot = new LinkedHashMap<>();
		plot.put("id", String.valueOf(source.get("id")));
		plot.put("status", CONTEXT_STATUSES.contains(status) ? status : "empty");
		plot.put("rings", rings);
		return plot;
	}

	/** The user moved the plots map: Google Earth Web looks at the same place, with the same height of ground in view. */
	@GetMapping(path = "/googleEarthWeb/camera")
	public void moveGoogleEarthWebCamera(HttpServletResponse response, @RequestParam("latitude") double latitude,
			@RequestParam("longitude") double longitude, @RequestParam("heightMeters") double heightMeters) {
		if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !(heightMeters > 0) || heightMeters > 2.0e7) {
			response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
			return;
		}
		executor.submit(() -> googleEarthWebService.moveCamera(latitude, longitude, heightMeters));
		response.setStatus(HttpServletResponse.SC_OK);
	}

	/** Lays out the plots map and Google Earth Web windows again (the layout chosen in the options). */
	@GetMapping(path = "/googleEarthWeb/arrange")
	public void arrangeGoogleEarthWebWindows(HttpServletResponse response) {
		executor.submit(windowLayoutService::arrange);
		response.setStatus(HttpServletResponse.SC_OK);
	}

	/** The plots map window was resized or moved: side by side, Google Earth Web takes the room left beside it. */
	@GetMapping(path = "/googleEarthWeb/followForm")
	public void followFormWindow(HttpServletResponse response) {
		executor.submit(windowLayoutService::followFormWindow);
		response.setStatus(HttpServletResponse.SC_OK);
	}

	@GetMapping(path = "/ancillaryWindows")
	public void openAuxiliaryWindowsNew(HttpServletResponse response, HttpServletRequest request) {

		List<AttributeDefinition> keyAttributeDefinitions = earthSurveyService
				.getRootEntityDefinition()
				.getKeyAttributeDefinitions();

		// the keys should be the parameter names
		Map<String, String[]> keys = request.getParameterMap();

		String[] keysInOrder = new String[keyAttributeDefinitions.size()];
		for (int i = 0; i < keyAttributeDefinitions.size(); i++) {
			String[] keyValues = keys.get(keyAttributeDefinitions.get(i).getName());
			if (keyValues != null && keyValues.length > 0) {
				keysInOrder[i] = keyValues[0];
			} else {
				logger.warn("Missing key parameter: {}", keyAttributeDefinitions.get(i).getName());
				response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
				return;
			}
		}

		try {
			kmlGenerator = kmlGeneratorService.getKmlGenerator();

			String[] csvValues = getValuesFromCsv(keysInOrder);

			if (csvValues == null) {
				logger.warn("Keys {} not found in CSV file", keys);
				response.setStatus(HttpServletResponse.SC_NOT_FOUND);
				return;
			}

			SimplePlacemarkObject placemarkObject = kmlGenerator.getPlotObject(csvValues, null, earthSurveyService.getCollectSurvey(), false);
			OpenBrowserThread browserThread = new OpenBrowserThread("Open ancillary windows - polygon", placemarkObject);
			browserThread.start();
			response.setStatus(HttpServletResponse.SC_OK);
		} catch (Exception e) {
			logger.error("Error loading browsers", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
		}
	}

	private String[] getValuesFromCsv(String[] keysInOrder) {
		final String csvFile = localPropertiesService.getCsvFile();
		try (CSVReader reader = CsvReaderUtils.getCsvReader(csvFile)) {

			String[] csvRow;
			int numberOfKeys = keysInOrder.length;
			while ((csvRow = reader.readNext()) != null) {
				boolean foundIt = true;
				for (int idx = 0; idx < numberOfKeys; idx++) {
					if (!csvRow[idx].equals(keysInOrder[idx])) {
						foundIt = false;
						break; // No need to check remaining keys
					}
				}

				if (foundIt) {
					return csvRow;
				}
			}

		} catch (Exception e) {
			logger.error("Error reading data from the CSV containing the plot locations", e);
		}
		return null;
	}

}
