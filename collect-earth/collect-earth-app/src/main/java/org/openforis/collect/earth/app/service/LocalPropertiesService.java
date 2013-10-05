package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Properties;
import java.util.TreeSet;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class LocalPropertiesService {

	public static final String OPERATOR_KEY = "operator";
	public static final String SKIP_FILLED_KEY = "skip_filled_plots";
	public static final String HOST_KEY = "host";
	public static final String PORT_KEY = "port";
	public static final String CSV_KEY = "csv";
	public static final String KML_TEMPLATE_KEY = "template";
	public static final String BALLOON_TEMPLATE_KEY = "balloon";
	public static final String CRS_KEY = "coordinates_reference_system";
	public static final String GENERATED_KEY = "generated_on";
	public static final String OPEN_EARTH_ENGINE = "open_earth_engine";
	private final Logger logger = LoggerFactory.getLogger(LocalPropertiesService.class);
	private Properties properties;
	public static final String PROPERTIES_FILE = "earth.properties";
	private static final String KML_TEMPLATE_KEY_CHECKSUM = "template_checksum";
	private static final String BALLOON_TEMPLATE_KEY_CHECKSUM = "balloon_checksum";
	private static final String CSV_KEY_CHECKSUM = "csv_checksum";
	public static final String DISTANCE_BETWEEN_SAMPLE_POINTS= "distance_between_sample_points";
	public static final String DISTANCE_TO_PLOT_BOUNDARIES = "distance_to_plot_boundaries";
	public static final String INNER_SUBPLOT_SIDE = "inner_point_side";
	public static final String SAMPLE_SHAPE = "sample_shape";
	public static final String OPEN_BALLOON_IN_FIREFOX = "open_separate_browser_form";
	public static final String SIMPLE_BALLOON_FOR_FIREFOX = "simple_balloon_for_firefox";
	public static final String FILES_TO_INCLUDE_IN_KMZ = "include_files_kmz";
	public static final String ELEVATION_GEOTIF_DIRECTORY = "elevation_geotif_directory";
	public static final String METADATA_FILE = "metadata_file";
	public static final String FIREFOX_BINARY_PATH = "firefox_exe_path";
	public static final String CHROME_BINARY_PATH = "chrome_exe_path";
	public static final String BROWSER_TO_USE = "use_browser";
	public static final String GEE_FUNCTION_PICK = "gee_js_pickFunction";
	public static final String GEE_ZOOM_OBJECT = "gee_js_zoom_object";
	public static final String GEE_ZOOM_METHOD = "gee_js_zoom_method";
	public static final String GEE_INITIAL_ZOOM = "gee_initial_zoom";
	

	public LocalPropertiesService() {

	}

	public void init() throws IOException {
		properties = new Properties() {
		    @Override
		    public synchronized Enumeration<Object> keys() {
		        return Collections.enumeration(new TreeSet<Object>(super.keySet()));
		    }
		};
		
		FileReader fr = null;
		try {

			File propertiesFile = new File(PROPERTIES_FILE);
			if (!propertiesFile.exists()) {
				boolean success = propertiesFile.createNewFile();
				if (!success) {
					throw new IOException("Could not create file " + propertiesFile.getAbsolutePath());
				}
			}
			fr = new FileReader(propertiesFile);
			properties.load(fr);
		} catch (FileNotFoundException e) {
			logger.error("Could not find properties file", e);
		} catch (IOException e) {
			logger.error("Could not open properties file", e);
		} finally {
			if (fr != null) {
				fr.close();
			}
		}
	}

	public String getValue(String key) {
		String value = "";
		if (properties.get(key) != null) {
			value = (String) properties.get(key);
		}

		return value;
	}

	public String getHost() {
		return getValue(HOST_KEY);
	}

	public void saveHost(String hostName) {
		properties.put(HOST_KEY, hostName);
		storeProperties();
	}

	public void setValue(String key, String value){
		properties.setProperty(key, value);
		storeProperties();
	}
	
	public String getTemplateFile() {
		return getValue(KML_TEMPLATE_KEY);
	}

	public String getTemplateFileChecksum() {
		return getValue(KML_TEMPLATE_KEY_CHECKSUM);
	}

	public void saveTemplateFileChecksum(String checksum) {
		properties.put(KML_TEMPLATE_KEY_CHECKSUM, checksum);
		storeProperties();
	}

	public String getBalloonFile() {
		return getValue(BALLOON_TEMPLATE_KEY);
	}

	public String getBalloonFileChecksum() {
		return getValue(BALLOON_TEMPLATE_KEY_CHECKSUM);
	}

	public void saveBalloonFileChecksum(String checksum) {
		properties.put(BALLOON_TEMPLATE_KEY_CHECKSUM, checksum);
		storeProperties();
	}

	public String getCsvFile() {
		return getValue(CSV_KEY);
	}

	public void saveCsvFile(String csvFile) {
		properties.put(CSV_KEY, csvFile);
		storeProperties();
	}

	public String getCsvFileChecksum() {
		return getValue(CSV_KEY_CHECKSUM);
	}

	public void saveCsvFileCehcksum(String checksum) {
		properties.put(CSV_KEY_CHECKSUM, checksum);
		storeProperties();
	}

	public String getGeneratedOn() {
		return getValue(GENERATED_KEY);
	}

	public void saveGeneratedOn(String dateGenerated) {
		properties.put(GENERATED_KEY, dateGenerated);
		storeProperties();
	}

	public String getPort() {
		return getValue(PORT_KEY);
	}

	public void savePort(String portName) {
		properties.put(PORT_KEY, portName);
		storeProperties();
	}

	public String getCrs() {
		return getValue(CRS_KEY);
	}

	public void saveCrs(String crsName) {
		properties.put(CRS_KEY, crsName);
		storeProperties();
	}

	public String getOperator() {
		return getValue(OPERATOR_KEY);
	}

	public void saveOperator(String operatorName) {
		properties.put(OPERATOR_KEY, operatorName);
		storeProperties();
	}

	public boolean shouldSkipFilledPlots() {
		boolean skipFilled = false;
		if (properties.get(SKIP_FILLED_KEY) != null && ((String) properties.get(SKIP_FILLED_KEY)).length() > 0) {
			skipFilled = Boolean.parseBoolean((String) properties.get(SKIP_FILLED_KEY));
		}

		return skipFilled;
	}

	public boolean isEarthEngineSupported() {
		boolean earthEngine = false;
		if (properties.get(OPEN_EARTH_ENGINE) != null && ((String) properties.get(OPEN_EARTH_ENGINE)).length() > 0) {
			earthEngine = Boolean.parseBoolean((String) properties.get(OPEN_EARTH_ENGINE));
		}

		return earthEngine;
	}


	public void setSkipFilledPlots(String shouldSkip) {
		String booleanSkip = "";
		if (shouldSkip != null && shouldSkip.length() > 0) {
			if (shouldSkip.equals("on")) {
				booleanSkip = "true";
			} else if (shouldSkip.equals("off")) {
				booleanSkip = "false";
			}
		} else {
			booleanSkip = "false";
		}
		properties.put(SKIP_FILLED_KEY, booleanSkip);
		storeProperties();
	}

	private synchronized void storeProperties() {
		FileWriter fw = null;
		try {
			fw = new FileWriter(new File(PROPERTIES_FILE));
			properties.store(fw, null);
		} catch (IOException e) {
			logger.error("The properties could not be saved", e);
		} finally {
			try {
				if (fw != null) {
					fw.close();
				}
			} catch (IOException e) {
				logger.error("Error closing file writer", e);
			}
		}
	}

}
