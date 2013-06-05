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

	public static final String OPERATOR_KEY = "operator";

	private final Logger logger = LoggerFactory.getLogger(LocalPropertiesService.class);

	Properties properties;

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

	public String getOperator() {
		String operator = "";
		if (properties.get(OPERATOR_KEY) != null) {
			operator = (String) properties.get(OPERATOR_KEY);
		}

		return operator;
	}

	public void saveOperator(String operatorName) {
		properties.put(OPERATOR_KEY, operatorName);
		storeProperties();
	}

	private void storeProperties() {
		try {
			properties.store(new FileWriter(new File(PROPERTIES_FILE)), null);
		} catch (IOException e) {
			logger.error("The properties could not be saved", e);
		}
	}

}
