package org.openforis.eye.service;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Properties;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class LocalPropertiesService {

	private static final String OPERATOR_KEY = "operator";
	private static final String SKIP_FILLED_KEY = "skip_filled_plots";
	private static final String HOST_KEY = "host";
	private static final String PORT_KEY = "port";
	private final Logger logger = LoggerFactory.getLogger(LocalPropertiesService.class);
	private Properties properties;
	private static final String PROPERTIES_FILE = "eye.properties";

	public LocalPropertiesService() {

	}

	public void init() {
		properties = new Properties();
		try {

			File propertiesFile = new File(PROPERTIES_FILE);
			if (!propertiesFile.exists()) {
				propertiesFile.createNewFile();
			}
			properties.load(new FileReader(propertiesFile));
		} catch (FileNotFoundException e) {
			logger.error("Could not find properties file", e);
		} catch (IOException e) {
			logger.error("Could not open properties file", e);
		}
	}

	private String getValue(String key) {
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

	public String getPort() {
		return getValue(PORT_KEY);
	}

	public void savePort(String portName) {
		properties.put(PORT_KEY, portName);
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

	public void setSkipFilledPlots(String shouldSkip) {
		if (shouldSkip != null && shouldSkip.length() > 0) {
			if (shouldSkip.equals("on")) {
				shouldSkip = "true";
			} else if (shouldSkip.equals("off")) {
				shouldSkip = "false";
			}
		} else {
			shouldSkip = "false";
		}
		properties.put(SKIP_FILLED_KEY, shouldSkip);
		storeProperties();
	}

	private synchronized void storeProperties() {
		try {
			properties.store(new FileWriter(new File(PROPERTIES_FILE)), null);
		} catch (IOException e) {
			logger.error("The properties could not be saved", e);
		}
	}

}
