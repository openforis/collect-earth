package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Properties;

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

	public LocalPropertiesService() {

	}

	public void init() throws IOException {
		properties = new Properties();
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
