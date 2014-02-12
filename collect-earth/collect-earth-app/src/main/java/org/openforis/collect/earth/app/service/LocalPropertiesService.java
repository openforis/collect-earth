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

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Class to access Collect Earth configuration. This class is used all over the code in order to fetch the values of the properties that can be configured by the user, by directly editing the earth.properties file or by using the Tools->Properties menu option in the Collect Earth Window.  
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class LocalPropertiesService {

	/**
	 * Enumeration containing the names of all the possible values that can be configured in Collect Earth.
	 * @author Alfonso Sanchez-Paus Diaz
	 *
	 */
	public enum EarthProperty {
		OPERATOR_KEY("operator"), JUMP_TO_NEXT("jump_to_next_plot"), HOST_KEY("host"), PORT_KEY("port"), CSV_KEY("csv"), KML_TEMPLATE_KEY("template"), BALLOON_TEMPLATE_KEY(
				"balloon"), CRS_KEY("coordinates_reference_system"), GENERATED_KEY("generated_on"), OPEN_BING_MAPS("open_bing_maps"),
				OPEN_EARTH_ENGINE("open_earth_engine"), OPEN_TIMELAPSE(
				"open_timelapse"), KML_TEMPLATE_KEY_CHECKSUM("template_checksum"), BALLOON_TEMPLATE_KEY_CHECKSUM("balloon_checksum"), CSV_KEY_CHECKSUM(
				"csv_checksum"), DISTANCE_BETWEEN_SAMPLE_POINTS("distance_between_sample_points"), DISTANCE_TO_PLOT_BOUNDARIES(
				"distance_to_plot_boundaries"), INNER_SUBPLOT_SIDE("inner_point_side"), SAMPLE_SHAPE("sample_shape"), OPEN_BALLOON_IN_BROWSER(
				"open_separate_browser_form"), ALTERNATIVE_BALLOON_FOR_BROWSER("alternative_balloon_for_browser"), ELEVATION_GEOTIF_DIRECTORY(
				"elevation_geotif_directory"), METADATA_FILE("metadata_file"), FIREFOX_BINARY_PATH("firefox_exe_path"), CHROME_BINARY_PATH(
				"chrome_exe_path"), BROWSER_TO_USE("use_browser"), GEE_FUNCTION_PICK("gee_js_pickFunction"), GEE_ZOOM_OBJECT("gee_js_zoom_object"), GEE_ZOOM_METHOD(
				"gee_js_zoom_method"), GEE_INITIAL_ZOOM("gee_initial_zoom"), SURVEY_NAME("survey_name"), AUTOMATIC_BACKUP("automatic_backup"), NUMBER_OF_SAMPLING_POINTS_IN_PLOT(
				"number_of_sampling_points_in_plot"), GEE_JS_LIBRARY_URL("gee_js_library_url"), SAIKU_SERVER_FOLDER("saiku_server_folder"), INSTANCE_TYPE("instance_type"), 
				DB_DRIVER("db_driver"),DB_USERNAME("db_username"), DB_PASSWORD("db_password"), DB_NAME("db_name"), UI_LANGUAGE("ui_language");

		private String name;

		private EarthProperty(String name) {
			this.name = name;
		}

		@Override
		public String toString() {
			return name;
		}

	}

	private final Logger logger = LoggerFactory.getLogger(LocalPropertiesService.class);
	private Properties properties;
	private static final String PROPERTIES_FILE_PATH = "earth.properties";
	public LocalPropertiesService() {

	}

	public String getBalloonFile() {
		return getValue(EarthProperty.BALLOON_TEMPLATE_KEY);
	}

	public String getBalloonFileChecksum() {
		return getValue(EarthProperty.BALLOON_TEMPLATE_KEY_CHECKSUM);
	}

	public String getCrs() {
		return getValue(EarthProperty.CRS_KEY);
	}

	public String getCsvFile() {
		return getValue(EarthProperty.CSV_KEY);
	}

	public String getCsvFileChecksum() {
		return getValue(EarthProperty.CSV_KEY_CHECKSUM);
	}

	public String getGeneratedOn() {
		return getValue(EarthProperty.GENERATED_KEY);
	}

	public String getHost() {
		return getValue(EarthProperty.HOST_KEY);
	}

	public String getOperator() {
		return getValue(EarthProperty.OPERATOR_KEY);
	}

	public String getPort() {
		return getValue(EarthProperty.PORT_KEY);
	}

	public String getTemplateFile() {
		return getValue(EarthProperty.KML_TEMPLATE_KEY);
	}

	public String getTemplateFileChecksum() {
		return getValue(EarthProperty.KML_TEMPLATE_KEY_CHECKSUM);
	}

	public String getValue(EarthProperty key) {
		String value = (String) properties.get(key.toString());
		if (value == null) {
			value = "";
		}

		return value;
	}

	@PostConstruct
	public void init() throws IOException {
		properties = new Properties() {
			/**
			 * 
			 */
			private static final long serialVersionUID = 4358906731731542445L;

			@Override
			public synchronized Enumeration<Object> keys() {
				return Collections.enumeration(new TreeSet<Object>(super.keySet()));
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

	public boolean isBingMapsSupported() {
		boolean bingMaps = false;
		if (getValue(EarthProperty.OPEN_BING_MAPS) != null && getValue(EarthProperty.OPEN_BING_MAPS).length() > 0) {
			bingMaps = Boolean.parseBoolean(getValue(EarthProperty.OPEN_BING_MAPS));
		}
		return bingMaps;
	}
	
	public boolean isEarthEngineSupported() {
		boolean earthEngine = false;
		if (getValue(EarthProperty.OPEN_EARTH_ENGINE) != null && getValue(EarthProperty.OPEN_EARTH_ENGINE).length() > 0) {
			earthEngine = Boolean.parseBoolean(getValue(EarthProperty.OPEN_EARTH_ENGINE));
		}

		return earthEngine;
	}

	public boolean isTimelapseSupported() {
		boolean timelapseSupported = false;
		if (getValue(EarthProperty.OPEN_TIMELAPSE) != null && getValue(EarthProperty.OPEN_TIMELAPSE).length() > 0) {
			timelapseSupported = Boolean.parseBoolean(getValue(EarthProperty.OPEN_TIMELAPSE));
		}

		return timelapseSupported;
	}

	public void nullifyChecksumValues() {
		saveBalloonFileChecksum("");
		saveCsvFileCehcksum("");
		saveTemplateFileChecksum("");
	}

	public void saveBalloonFileChecksum(String checksum) {
		setValue(EarthProperty.BALLOON_TEMPLATE_KEY_CHECKSUM, checksum);

	}

	public void saveCrs(String crsName) {
		setValue(EarthProperty.CRS_KEY, crsName);

	}

	public void saveCsvFile(String csvFile) {
		setValue(EarthProperty.CSV_KEY, csvFile);

	}

	public void saveCsvFileCehcksum(String checksum) {
		setValue(EarthProperty.CSV_KEY_CHECKSUM, checksum);

	}

	public void saveGeneratedOn(String dateGenerated) {
		setValue(EarthProperty.GENERATED_KEY, dateGenerated);

	}

	public void saveHost(String hostName) {
		setValue(EarthProperty.HOST_KEY, hostName);

	}

	public void saveOperator(String operatorName) {
		setValue(EarthProperty.OPERATOR_KEY, operatorName);

	}

	public void savePort(String portName) {
		setValue(EarthProperty.PORT_KEY, portName);

	}

	public void saveTemplateFileChecksum(String checksum) {
		setValue(EarthProperty.KML_TEMPLATE_KEY_CHECKSUM, checksum);

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

	public void setValue(EarthProperty key, String value) {
		properties.setProperty(key.toString(), value);
		storeProperties();
	}

	public boolean shouldJumpToNextPlot() {
		boolean jumpToNext = false;
		if (getValue(EarthProperty.JUMP_TO_NEXT) != null && getValue(EarthProperty.JUMP_TO_NEXT).length() > 0) {
			jumpToNext = Boolean.parseBoolean(getValue(EarthProperty.JUMP_TO_NEXT));
		}

		return jumpToNext;
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

	public UI_LANGUAGE getUiLanguage(){
		String value = getValue(EarthProperty.UI_LANGUAGE);
		if( StringUtils.isBlank( value ) ){
			return UI_LANGUAGE.EN;
		}else{
			return UI_LANGUAGE.valueOf( value );
		}
	}

	public void setUiLanguage(UI_LANGUAGE language) {
		setValue( EarthProperty.UI_LANGUAGE, language.name() );
	}
	
	public SAMPLE_SHAPE getSampleShape(){
		String value = getValue(EarthProperty.SAMPLE_SHAPE);
		if( StringUtils.isBlank( value ) ){
			return SAMPLE_SHAPE.SQUARE;
		}else{
			return SAMPLE_SHAPE.valueOf( value );
		}
	}

	public void setSampleShape(SAMPLE_SHAPE shape) {
		setValue( EarthProperty.SAMPLE_SHAPE, shape.name() );
	}
	
}
