package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.Properties;
import java.util.TreeSet;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.EarthConstants.UI_LANGUAGE;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Class to access Collect Earth configuration. This class is used all over the code in order to fetch the values of the properties that can be
 * configured by the user, by directly editing the earth.properties file or by using the Tools--Properties menu option in the Collect Earth Window.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Component
public class LocalPropertiesService {

	private static final String LOCAL_HOST = "127.0.0.1";

	/**
	 * Enumeration containing the names of all the possible values that can be configured in Collect Earth.
	 * 
	 * @author Alfonso Sanchez-Paus Diaz
	 * 
	 */
	public enum EarthProperty {
		OPERATOR_KEY("operator"), JUMP_TO_NEXT("jump_to_next_plot"), HOST_KEY("host"), HOST_PORT_KEY("port"), LOCAL_PORT_KEY("local_port"), CSV_KEY("csv"), KML_TEMPLATE_KEY("template"), BALLOON_TEMPLATE_KEY(
				"balloon"), CRS_KEY("coordinates_reference_system"), GENERATED_KEY("generated_on"), KML_TEMPLATE_KEY_CHECKSUM("template_checksum"), BALLOON_TEMPLATE_KEY_CHECKSUM(
				"balloon_checksum"), CSV_KEY_CHECKSUM("csv_checksum"), OPEN_BALLOON_IN_BROWSER(
				"open_separate_browser_form"), ALTERNATIVE_BALLOON_FOR_BROWSER("alternative_balloon_for_browser"), ELEVATION_GEOTIF_DIRECTORY(
				"elevation_geotif_directory"), METADATA_FILE("metadata_file"), FIREFOX_BINARY_PATH("firefox_exe_path"), CHROME_BINARY_PATH(
				"chrome_exe_path"), BROWSER_TO_USE("use_browser"), GEE_FUNCTION_PICK("gee_js_pickFunction"), GEE_ZOOM_OBJECT("gee_js_zoom_object"), GEE_ZOOM_METHOD(
				"gee_js_zoom_method"), GEE_INITIAL_ZOOM("gee_initial_zoom"), AUTOMATIC_BACKUP("automatic_backup"), GEE_JS_LIBRARY_URL("gee_js_library_url"), SAIKU_SERVER_FOLDER("saiku_server_folder"), OPERATION_MODE(
				"operation_mode"), DB_DRIVER("db_driver"), DB_USERNAME("db_username"), DB_PASSWORD("db_password"), DB_NAME("db_name"), DB_HOST(
				"db_host"), DB_PORT("db_port"), UI_LANGUAGE("ui_language"), LAST_USED_FOLDER("last_used_folder"), LAST_EXPORTED_DATE("last_exported_survey_date"), OPEN_GEE_PLAYGROUND("open_gee_playground"), OPEN_BING_MAPS("open_bing_maps"), OPEN_EARTH_ENGINE(
						"open_earth_engine"), OPEN_TIMELAPSE("open_timelapse"),DISTANCE_BETWEEN_SAMPLE_POINTS("distance_between_sample_points"), DISTANCE_TO_PLOT_BOUNDARIES(
								"distance_to_plot_boundaries"), INNER_SUBPLOT_SIDE("inner_point_side"), SAMPLE_SHAPE("sample_shape"),  SURVEY_NAME("survey_name"), GEE_PLAYGROUND_URL("gee_playground_url"), NUMBER_OF_SAMPLING_POINTS_IN_PLOT(
								"number_of_sampling_points_in_plot"), LOADED_PROJECTS("loaded_projects"), ACTIVE_PROJECT_DEFINITION("active_project_definition"), LAST_IGNORED_UPDATE("last_ignored_update_version");


		private String name;

		private EarthProperty(String name) {
			this.name = name;
		}

		@Override
		public String toString() {
			return name;
		}

	}

	private Logger logger =null;
	private Properties properties;
	private static final String PROPERTIES_FILE_PATH_INITIAL = "earth.properties_initial";
	private static final String PROPERTIES_FILE_PATH = FolderFinder.getLocalFolder() + File.separator + "earth.properties";

	public LocalPropertiesService() {

	}

	public String getBalloonFile() {
		return convertToOSPath( getValue(EarthProperty.BALLOON_TEMPLATE_KEY) );
	}

	public SAMPLE_SHAPE getSampleShape() {
		final String value = getValue(EarthProperty.SAMPLE_SHAPE);
		if (StringUtils.isBlank(value)) {
			return SAMPLE_SHAPE.SQUARE;
		} else {
			return SAMPLE_SHAPE.valueOf(value);
		}
	}

	
	
	public String getBalloonFileChecksum() {
		return getValue(EarthProperty.BALLOON_TEMPLATE_KEY_CHECKSUM);
	}

	public CollectDBDriver getCollectDBDriver() {

		final String collectDbDriver = getValue(EarthProperty.DB_DRIVER);
		if (collectDbDriver.length() == 0) {
			return CollectDBDriver.SQLITE;
		}
		return CollectDBDriver.valueOf(collectDbDriver);

	}
	
	public String getImdFile(){
		return convertToOSPath( getValue(EarthProperty.METADATA_FILE ) );
	}

	public String convertToOSPath(String path) {
		String pathSeparator = File.separator;
		path = path.replace("/", pathSeparator);
		path = path.replace("\\", pathSeparator);
		return path;
	}
	public String getCrs() {
		return getValue(EarthProperty.CRS_KEY);
	}

	public String getCsvFile() {
		return convertToOSPath( getValue(EarthProperty.CSV_KEY) );
	}

	public String getCsvFileChecksum() {
		return getValue(EarthProperty.CSV_KEY_CHECKSUM);
	}

	private String getExportedSurveyName(String surveyName) {
		return EarthProperty.LAST_EXPORTED_DATE + "_" + surveyName;
	}

	public String getGeneratedOn() {
		return getValue(EarthProperty.GENERATED_KEY);
	}

	public String getHost() {
		if( getOperationMode().equals(OperationMode.CLIENT_MODE ) ){
			return getValue(EarthProperty.HOST_KEY);
		}else{
			return LOCAL_HOST;
		}
	}

	public Date getLastExportedDate(String surveyName) {
		final String value = (String) properties.get(getExportedSurveyName(surveyName));
		Date lastExported = null;
		try {
			if (!StringUtils.isBlank(value)) {
				lastExported = new Date(Long.parseLong(value));
			}
		} catch (final NumberFormatException e) {
			logger.error("Error parsing date", e);
		}

		return lastExported;
	}

	public OperationMode getOperationMode() {
		final String instanceType = getValue(EarthProperty.OPERATION_MODE);
		if (instanceType.length() == 0) {
			return OperationMode.SERVER_MODE;
		}
		return OperationMode.valueOf(instanceType);
	}
	
	public String getOperator() {
		return getValue(EarthProperty.OPERATOR_KEY);
	}

	public String getPort() {
		return getValue(EarthProperty.HOST_PORT_KEY);
	}
	
	public String getLocalPort() {
		if( getOperationMode().equals( OperationMode.SERVER_MODE ) ){
			return getPort();
		}else{
			return getValue(EarthProperty.LOCAL_PORT_KEY);
		}
	}



	public String getTemplateFile() {
		return convertToOSPath( getValue(EarthProperty.KML_TEMPLATE_KEY) );
	}

	public String getTemplateFileChecksum() {
		return getValue(EarthProperty.KML_TEMPLATE_KEY_CHECKSUM);
	}

	public UI_LANGUAGE getUiLanguage() {
		final String value = getValue(EarthProperty.UI_LANGUAGE);
		if (StringUtils.isBlank(value)) {
			return UI_LANGUAGE.EN;
		} else {
			UI_LANGUAGE selected = null;
			try {
				selected = UI_LANGUAGE.valueOf(value.toUpperCase());
			} catch (Exception e) {
				logger.error("Unknown UI Language "+ value );
			}
			
			if( selected!=null){
				return selected;
			}else{
				return UI_LANGUAGE.EN;
			}
		}
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
		boolean removeInitialFile =false;
		File propertiesFileInitial = null;
		logger = LoggerFactory.getLogger(LocalPropertiesService.class);
		try {
			
			File propertiesFile = new File(PROPERTIES_FILE_PATH);						
			if (!propertiesFile.exists() || propertiesFile.length() < 300 ) {
				
				if(!propertiesFile.exists()  ){
					final boolean success = propertiesFile.createNewFile();
					if (!success) {
						throw new IOException("Could not create file " + propertiesFile.getAbsolutePath());
					}
				}
				
				propertiesFileInitial = new File(PROPERTIES_FILE_PATH_INITIAL);
				if( propertiesFileInitial.exists() ){
					removeInitialFile = true;
					propertiesFile = propertiesFileInitial;
				}
				
			}
			
			fr = new FileReader(propertiesFile);
			properties.load(fr);			
			
		} catch (final FileNotFoundException e) {
			logger.error("Could not find properties file", e);
		} catch (final IOException e) {
			logger.error("Could not open properties file", e);
		} finally {
			if (fr != null) {
				fr.close();
			}
			/*if( removeInitialFile ){
				propertiesFileInitial.deleteOnExit();
			}*/
		}
	}


	public void nullifyChecksumValues() {
		saveBalloonFileChecksum("");
		saveCsvFileCehcksum("");
		saveTemplateFileChecksum("");
		storeProperties();
	}

	/**
	 * Removes the GEE obfusted method/parameter names so that they are regenerated when GEE is accessed for the fist time.
	 * This way we avoid the bug when the reobfuscation of GEE JS code changes the zooming method but does not provoke an error.
	 */
	@PreDestroy
	public void removeGeeProperties() {
		
		this.storeProperties();
		
/*		this.setValue(EarthProperty.GEE_ZOOM_METHOD, "", false);
		this.setValue(EarthProperty.GEE_ZOOM_OBJECT, "", false);
		this.setValue(EarthProperty.GEE_FUNCTION_PICK, "", true);*/
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
		setValue(EarthProperty.HOST_PORT_KEY, portName);

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

	public void setLastExportedDate(String surveyName) {
		setValue(getExportedSurveyName(surveyName), System.currentTimeMillis() + "", true);
	}

	public void setUiLanguage(UI_LANGUAGE language) {
		setValue(EarthProperty.UI_LANGUAGE, language.name(), true);
	}

	public void setValue(EarthProperty key, String value) {
		setValue(key, value, true);
	}

	private void setValue(EarthProperty key, String value, boolean forceWrite) {
		setValue(key.toString(), value, forceWrite);
	}

	private void setValue(String key, String value, boolean forceWrite) {
		properties.setProperty(key, value);
		if (forceWrite) {
			storeProperties();
		}
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
		} catch (final IOException e) {
			logger.error("The properties could not be saved", e);
		} finally {
			try {
				if (fw != null) {
					fw.close();
				}
			} catch (final IOException e) {
				logger.error("Error closing file writer", e);
			}
		}
	}

	public boolean isUsingPostgreSqlDB() {
		return getCollectDBDriver().equals(CollectDBDriver.POSTGRESQL);
	}
	
	public boolean isUsingSqliteDB() {
		return getCollectDBDriver().equals(CollectDBDriver.SQLITE);
	}

	private boolean isPropertySupported( EarthProperty earthProperty ) {
		boolean supported = false;
		String value = getValue(earthProperty);
		if (value != null && value.length() > 0) {
			supported = Boolean.parseBoolean(value);
		}
		return supported;
	}
	
	public boolean isBingMapsSupported() {
		
		return isPropertySupported(EarthProperty.OPEN_BING_MAPS);
	}

	public boolean isGeePlaygroundSupported() {
		return isPropertySupported(EarthProperty.OPEN_GEE_PLAYGROUND);
	}
	
	public boolean isEarthEngineSupported() {
		return isPropertySupported(EarthProperty.OPEN_EARTH_ENGINE);
	}

	public boolean isTimelapseSupported() {
		return isPropertySupported(EarthProperty.OPEN_TIMELAPSE);
	}

	
	public void setSampleShape(SAMPLE_SHAPE shape) {
		setValue(EarthProperty.SAMPLE_SHAPE, shape.name());
	}

	
	public String getGeePlaygoundUrl(){
		
		if(  isPropertySupported(EarthProperty.GEE_PLAYGROUND_URL) ){
			return getValue(EarthProperty.GEE_PLAYGROUND_URL );
		}else{
			return "https://ee-api.appspot.com";
		}
	}
	
	public String getProjectFolder() {
		final File metadataFile = new File(getImdFile() );
		return metadataFile.getParent();
	}

}
