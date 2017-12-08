package org.openforis.collect.earth.app.server;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

import au.com.bytecode.opencsv.CSVReader;

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
	
	private SimplePlacemarkObject lastPlacemark = null;
	
	private final Logger logger = LoggerFactory.getLogger( PlacemarkBrowserServlet.class );
	
	private final class OpenBrowserThread extends Thread {
		
		private SimplePlacemarkObject placemarkObject;


		private OpenBrowserThread(String name, SimplePlacemarkObject placemarkObject) {
			super(name);
			this.placemarkObject = placemarkObject;	
		}


		@Override
		public void run() {
			// If this is the first plot or the plot is the last one that
			// was opened
			if (lastPlacemark == null
					|| !lastPlacemark.equals( placemarkObject ) ) {
				
				openGEEWindow(placemarkObject);
				
				openGeePlaygroundWindow(placemarkObject);

				openTimeLapseWindow(placemarkObject);

				openBingMapsWindow(placemarkObject);
				
				openYandexMapsWindow(placemarkObject);

				openExtraMapWindow(placemarkObject);
				
				openStreetViewWindow(placemarkObject);

				// Until further notice
				// openHereMapsWindow(placemarkObject);

			}

			lastPlacemark = placemarkObject;

		}

		/*
		 * public void openHereMapsWindow(final String latLongCoordinates) {
		 * new Thread("Open Here Maps window"){ //$NON-NLS-1$
		 * 
		 * @Override public void run() { try {
		 * browserService.openHereMaps(latLongCoordinates); } catch (final
		 * Exception e) { LoggerFactory.getLogger(this.getClass()).error(
		 * "Exception opening Here Maps window", e); //$NON-NLS-1$
		 * 
		 * } }
		 * 
		 * }.start(); }
		 */

		public void openGeePlaygroundWindow(final SimplePlacemarkObject placemarkObject) {
			new Thread("Open GEE Playground window") { //$NON-NLS-1$
				@Override
				public void run() {
					try {
						browserService
								.openGeeCodeEditor(placemarkObject);
					} catch (final Exception e) {
						LoggerFactory
								.getLogger(this.getClass())
								.error("Exception opening Earth Engine Playground window", e); //$NON-NLS-1$

					}
				}

			}.start();
		}

		public void openBingMapsWindow(final SimplePlacemarkObject placemarkObject) {
			new Thread("Open Bing Maps window") { //$NON-NLS-1$
				@Override
				public void run() {
					try {
						browserService.openBingMaps(placemarkObject);
					} catch (final Exception e) {
						LoggerFactory.getLogger(this.getClass()).error(
								"Exception opening Bing Maps window", e); //$NON-NLS-1$

					}
				}

			}.start();
		}

		public void openYandexMapsWindow(final SimplePlacemarkObject placemarkObject) {
			new Thread("Open Yandex Maps window") { //$NON-NLS-1$
				@Override
				public void run() {
					try {
						browserService.openYandexMaps(placemarkObject);
					} catch (final Exception e) {
						LoggerFactory.getLogger(this.getClass()).error(
								"Exception opening Yandex Maps window", e); //$NON-NLS-1$

					}
				}

			}.start();
		}
		
		public void openExtraMapWindow(final SimplePlacemarkObject placemarkObject) {
			new Thread("Open Expa Map window") { //$NON-NLS-1$
				@Override
				public void run() {
					try {
						browserService.openExtraMap(placemarkObject);
					} catch (final Exception e) {
						LoggerFactory.getLogger(this.getClass()).error(
								"Exception opening Extra Map window", e); //$NON-NLS-1$

					}
				}

			}.start();
		}
		
		public void openStreetViewWindow(final SimplePlacemarkObject placemarkObject) {
			new Thread("Open Street View window") { //$NON-NLS-1$
				@Override
				public void run() {
					try {
						browserService.openStreetView(placemarkObject);
					} catch (final Exception e) {
						LoggerFactory.getLogger(this.getClass()).error(
								"Exception opening Street View window", e); //$NON-NLS-1$

					}
				}

			}.start();
		}

		public void openTimeLapseWindow(final SimplePlacemarkObject placemarkObject) {
			new Thread("Open TimeLapse window") { //$NON-NLS-1$
				@Override
				public void run() {
					try {
						browserService.openTimelapse(placemarkObject);
					} catch (final Exception e) {
						LoggerFactory.getLogger(this.getClass()).error(
								"Exception opening Earth Engine window", e); //$NON-NLS-1$

					}
				}

			}.start();
		}

		public void openGEEWindow(final SimplePlacemarkObject placemarkObject) {
			new Thread("Open GEE window") { //$NON-NLS-1$
				@Override
				public void run() {
					try {
						browserService.openEarthEngine(placemarkObject);
					} catch (final Exception e) {
						LoggerFactory.getLogger(this.getClass()).error(
								"Exception opening Earth Engine window", e); //$NON-NLS-1$

					}
				}

			}.start();
		}
	}


	/*
	 * Returns a JSON object with the data colleted for a placemark in the
	 * collect-earth format. It also opens the extra browser windows for Earth
	 * Engine, Timelapse and Bing. (non-Javadoc)
	 * 
	 * @see
	 * org.openforis.collect.earth.app.server.JsonPocessorServlet#processRequest
	 * (javax.servlet.http.HttpServletRequest,
	 * javax.servlet.http.HttpServletResponse)
	 */
	@RequestMapping("/openAuxiliaryWindows")
	protected void openAuxiliaryWindows(
			HttpServletResponse response,
			@RequestParam(value = "latLongCoordinates", required = false) final String latLongCoordinates)
			{
		try {
			SimplePlacemarkObject placemarkObject = new SimplePlacemarkObject(latLongCoordinates.split(",") );
			OpenBrowserThread browserThread = new OpenBrowserThread("Open auxiliary windows " + latLongCoordinates, placemarkObject);
			browserThread.start();
		} catch (Exception e) {
			logger.error("Error loading browsers " , e);
		}
	}

	@RequestMapping("/ancillaryWindows")
	protected void openAuxiliaryWindowsNew(HttpServletResponse response, HttpServletRequest request) throws IOException {

		
		List<AttributeDefinition> keyAttributeDefinitions = earthSurveyService
				.getRootEntityDefinition()
				.getKeyAttributeDefinitions();
		
		// the keys should the the parameter names
		Map<String, String[]> keys = request.getParameterMap();

		String[] keysInOrder = new String[keys.size()];
		for (int i = 0; i < keyAttributeDefinitions.size(); i++) {
			keysInOrder[i] = keys.get(keyAttributeDefinitions.get(i).getName())[0];
		}

		try {
			String[] csvValues = getValuesFromCsv(keysInOrder);
			
			if( csvValues == null ){
				throw new IllegalArgumentException("The keys " + keys.toString() + " are not present on the CSV file with the plot lcoations!!!");
			}
			
			SimplePlacemarkObject placemarkObject = KmlGenerator.getPlotObject(csvValues, null, earthSurveyService.getCollectSurvey() );
			OpenBrowserThread browserThread = new OpenBrowserThread("Open ancillary windows - polygon ", placemarkObject );
			browserThread.start();
		} catch (Exception e) {
			logger.error("Error loading browsers " , e);
		}

	}

	private String[] getValuesFromCsv(String[] keysInOrder) {
		CSVReader reader = null;
		
		try {
			final String csvFile = localPropertiesService.getCsvFile();
			reader = CsvReaderUtils.getCsvReader(csvFile);
			String[] csvRow;
			int numberOfKeys = keysInOrder.length;
			while ((csvRow = reader.readNext()) != null) {
				boolean foundIt = true;
				for( int idx=0; idx<numberOfKeys; idx++){
					if( !csvRow[idx].equals(keysInOrder[idx]) ){
						foundIt = false;
					}
				}
				
				if( foundIt ){
					return csvRow;
				}
				
			}
			
			
		}catch(Exception e){
			logger.error("Error reading data from the CSV containing the plot locations ", e);
		}
		return null;
		
	}

}
