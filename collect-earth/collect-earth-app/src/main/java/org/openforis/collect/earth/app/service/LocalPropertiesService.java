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


	private final Logger logger = LoggerFactory.getLogger(LocalPropertiesService.class);
	private Properties properties;
	private static final String PROPERTIES_FILE_PATH = "earth.properties";
	
	public static final String CHROME_BROWSER = "chrome";
	public static final String FIREFOX_BROWSER = "firefox";

	public enum EarthProperty {
		OPERATOR_KEY("operator"),
		JUMP_TO_NEXT("jump_to_next_plot"),
		HOST_KEY("host"),
		PORT_KEY ( "port"),
		CSV_KEY ( "csv"),
		KML_TEMPLATE_KEY ( "template"),
		BALLOON_TEMPLATE_KEY ("balloon"),
		CRS_KEY ("coordinates_reference_system"),
		GENERATED_KEY ("generated_on"),
		OPEN_EARTH_ENGINE ("open_earth_engine"),
		KML_TEMPLATE_KEY_CHECKSUM ( "template_checksum"),
		BALLOON_TEMPLATE_KEY_CHECKSUM ( "balloon_checksum"),
		CSV_KEY_CHECKSUM ( "csv_checksum"),
		DISTANCE_BETWEEN_SAMPLE_POINTS ( "distance_between_sample_points"),
		DISTANCE_TO_PLOT_BOUNDARIES ( "distance_to_plot_boundaries"),
		INNER_SUBPLOT_SIDE ( "inner_point_side"),
		SAMPLE_SHAPE ( "sample_shape"),
		OPEN_BALLOON_IN_BROWSER ( "open_separate_browser_form"),
		ALTERNATIVE_BALLOON_FOR_BROWSER ( "alternative_balloon_for_browser"),
		FILES_TO_INCLUDE_IN_KMZ ( "include_files_kmz"),
		ELEVATION_GEOTIF_DIRECTORY ( "elevation_geotif_directory"),
		METADATA_FILE ( "metadata_file"),
		FIREFOX_BINARY_PATH ( "firefox_exe_path"),
		CHROME_BINARY_PATH ( "chrome_exe_path"),
		BROWSER_TO_USE ( "use_browser"),
		GEE_FUNCTION_PICK ( "gee_js_pickFunction"),
		GEE_ZOOM_OBJECT ( "gee_js_zoom_object"),
		GEE_ZOOM_METHOD ( "gee_js_zoom_method"),
		GEE_INITIAL_ZOOM ( "gee_initial_zoom"),	
		SURVEY_NAME("survey_name"),
		NUMBER_OF_SAMPLING_POINTS_IN_PLOT ("number_of_sampling_points_in_plot");

		private String name;
		private EarthProperty( String name) {
			this.name = name ;
		}

		@Override
		public String toString() {
			return name;
		}
						
	}

	public LocalPropertiesService() {

	}

	public void init() throws IOException {
		properties = new Properties() {
			/**
			 * 
			 */
			private static final long serialVersionUID = 4358906731731542445L;

			@Override
			public synchronized Enumeration<Object> keys() {
				return Collections.enumeration(new TreeSet<Object>( super.keySet()  ));
			}
			
			
		};

		FileReader fr = null;
		try {

			File propertiesFile = new File(PROPERTIES_FILE_PATH);
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
	
	public void nullifyChecksumValues(){
		saveBalloonFileChecksum("");
		saveCsvFileCehcksum("");
		saveTemplateFileChecksum("");
	}

	public String getValue(EarthProperty key) {
		String value = (String) properties.get(key.toString());
		if ( value == null) {
			value = "";
		}

		return value;
	}

	public String getHost() {
		return getValue(EarthProperty.HOST_KEY);
	}

	public void saveHost(String hostName) {
		setValue(EarthProperty.HOST_KEY, hostName);
		
	}

	public void setValue(EarthProperty key, String value){
		properties.setProperty(key.toString(), value);
		storeProperties();
	}

	public String getTemplateFile() {
		return getValue(EarthProperty.KML_TEMPLATE_KEY);
	}

	public String getTemplateFileChecksum() {
		return getValue(EarthProperty.KML_TEMPLATE_KEY_CHECKSUM);
	}

	public void saveTemplateFileChecksum(String checksum) {
		setValue(EarthProperty.KML_TEMPLATE_KEY_CHECKSUM, checksum);
		
	}

	public String getBalloonFile() {
		return getValue(EarthProperty.BALLOON_TEMPLATE_KEY);
	}

	public String getBalloonFileChecksum() {
		return getValue(EarthProperty.BALLOON_TEMPLATE_KEY_CHECKSUM);
	}

	public void saveBalloonFileChecksum(String checksum) {
		setValue(EarthProperty.BALLOON_TEMPLATE_KEY_CHECKSUM, checksum);
		
	}

	public String getCsvFile() {
		return getValue(EarthProperty.CSV_KEY);
	}

	public void saveCsvFile(String csvFile) {
		setValue(EarthProperty.CSV_KEY, csvFile);
		
	}

	public String getCsvFileChecksum() {
		return getValue(EarthProperty.CSV_KEY_CHECKSUM);
	}

	public void saveCsvFileCehcksum(String checksum) {
		setValue(EarthProperty.CSV_KEY_CHECKSUM, checksum);
		
	}

	public String getGeneratedOn() {
		return getValue(EarthProperty.GENERATED_KEY);
	}

	public void saveGeneratedOn(String dateGenerated) {
		setValue(EarthProperty.GENERATED_KEY, dateGenerated);
		
	}

	public String getPort() {
		return getValue(EarthProperty.PORT_KEY);
	}

	public void savePort(String portName) {
		setValue(EarthProperty.PORT_KEY, portName);
		
	}

	public String getCrs() {
		return getValue(EarthProperty.CRS_KEY);
	}

	public void saveCrs(String crsName) {
		setValue(EarthProperty.CRS_KEY, crsName);
		
	}

	public String getOperator() {
		return getValue(EarthProperty.OPERATOR_KEY);
	}

	public void saveOperator(String operatorName) {
		setValue(EarthProperty.OPERATOR_KEY, operatorName);
		
	}

	public boolean shouldJumpToNextPlot() {
		boolean jumpToNext = false;
		if ( getValue(EarthProperty.JUMP_TO_NEXT) != null && ((String) getValue(EarthProperty.JUMP_TO_NEXT)).length() > 0) {
			jumpToNext = Boolean.parseBoolean((String) getValue(EarthProperty.JUMP_TO_NEXT));
		}

		return jumpToNext;
	}

	public boolean isEarthEngineSupported() {
		boolean earthEngine = false;
		if (getValue(EarthProperty.OPEN_EARTH_ENGINE) != null && ((String) getValue(EarthProperty.OPEN_EARTH_ENGINE)).length() > 0) {
			earthEngine = Boolean.parseBoolean((String)getValue(EarthProperty.OPEN_EARTH_ENGINE));
		}

		return earthEngine;
	}


	public void setJumpToNextPlot(String shouldSkip) {
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
		setValue(EarthProperty.JUMP_TO_NEXT, booleanSkip);
		
	}

	private synchronized void storeProperties() {
		FileWriter fw = null;
		try {
			fw = new FileWriter(new File(PROPERTIES_FILE_PATH));
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
