package org.openforis.collect.earth.app.server;

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
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
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
import org.springframework.web.bind.annotation.RequestParam;

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
			@RequestParam(value = "latLongCoordinates", required = false) final String latLongCoordinates)
	{
		if (latLongCoordinates == null || latLongCoordinates.isEmpty()) {
			response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
			return;
		}

		try {
			kmlGenerator = kmlGeneratorService.getKmlGenerator();
			SimplePlacemarkObject placemarkObject = new SimplePlacemarkObject(latLongCoordinates.split(","));
			OpenBrowserThread browserThread = new OpenBrowserThread("Open auxiliary windows " + latLongCoordinates, placemarkObject);
			browserThread.start();
			response.setStatus(HttpServletResponse.SC_OK);
		} catch (Exception e) {
			logger.error("Error loading browsers", e);
			response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
		}
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
