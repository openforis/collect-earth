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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Class to access Collect Earth configuration. This class is used all over the code in order to fetch the values of the properties that can be
 * configured by the user, by directly editing the earth.properties file or by using the Tools->Properties menu option in the Collect Earth Window.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Component
public class ProjectPropertiesService {

	private static final String LOCAL_HOST = "127.0.0.1";

	/**
	 * Enumeration containing the names of all the possible values that can be configured in Collect Earth.
	 * 
	 * @author Alfonso Sanchez-Paus Diaz
	 * 
	 */
	public enum ProjectProperty {
		OPEN_BING_MAPS("open_bing_maps"), OPEN_EARTH_ENGINE(
				"open_earth_engine"), OPEN_TIMELAPSE("open_timelapse"),DISTANCE_BETWEEN_SAMPLE_POINTS("distance_between_sample_points"), DISTANCE_TO_PLOT_BOUNDARIES(
				"distance_to_plot_boundaries"), INNER_SUBPLOT_SIDE("inner_point_side"), SAMPLE_SHAPE("sample_shape"),  SURVEY_NAME("survey_name"), NUMBER_OF_SAMPLING_POINTS_IN_PLOT(
				"number_of_sampling_points_in_plot"),;

		private String name;

		private ProjectProperty(String name) {
			this.name = name;
		}

		@Override
		public String toString() {
			return name;
		}

	}

	private final Logger logger = LoggerFactory.getLogger(ProjectPropertiesService.class);
	private Properties properties;
	private String propertyFilePath;


	public ProjectPropertiesService( ) throws IOException {
	}

	

	public String convertToOSPath(String path) {
		String pathSeparator = File.separator;
		path = path.replace("/", pathSeparator);
		path = path.replace("\\", pathSeparator);
		return path;
	}
	

	public SAMPLE_SHAPE getSampleShape() {
		final String value = getValue(ProjectProperty.SAMPLE_SHAPE);
		if (StringUtils.isBlank(value)) {
			return SAMPLE_SHAPE.SQUARE;
		} else {
			return SAMPLE_SHAPE.valueOf(value);
		}
	}

	

	public String getValue(ProjectProperty key) {
		String value = (String) properties.get(key.toString());
		if (value == null) {
			value = "";
		}

		return value;
	}


	public void init(String propertyFilePath) throws IOException {
		this.propertyFilePath = propertyFilePath;
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
			File propertiesFile = new File(propertyFilePath);						
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

		}
	}

	public boolean isBingMapsSupported() {
		boolean bingMaps = false;
		if (getValue(ProjectProperty.OPEN_BING_MAPS) != null && getValue(ProjectProperty.OPEN_BING_MAPS).length() > 0) {
			bingMaps = Boolean.parseBoolean(getValue(ProjectProperty.OPEN_BING_MAPS));
		}
		return bingMaps;
	}

	public boolean isEarthEngineSupported() {
		boolean earthEngine = false;
		if (getValue(ProjectProperty.OPEN_EARTH_ENGINE) != null && getValue(ProjectProperty.OPEN_EARTH_ENGINE).length() > 0) {
			earthEngine = Boolean.parseBoolean(getValue(ProjectProperty.OPEN_EARTH_ENGINE));
		}

		return earthEngine;
	}

	public boolean isTimelapseSupported() {
		boolean timelapseSupported = false;
		if (getValue(ProjectProperty.OPEN_TIMELAPSE) != null && getValue(ProjectProperty.OPEN_TIMELAPSE).length() > 0) {
			timelapseSupported = Boolean.parseBoolean(getValue(ProjectProperty.OPEN_TIMELAPSE));
		}

		return timelapseSupported;
	}

	
	public void setSampleShape(SAMPLE_SHAPE shape) {
		setValue(ProjectProperty.SAMPLE_SHAPE, shape.name());
	}



	public void setValue(ProjectProperty key, String value) {
		setValue(key, value, true);
	}

	private void setValue(ProjectProperty key, String value, boolean forceWrite) {
		setValue(key.toString(), value, forceWrite);
	}

	private void setValue(String key, String value, boolean forceWrite) {
		properties.setProperty(key, value);
		if (forceWrite) {
			storeProperties();
		}
	}



	private synchronized void storeProperties() {
		FileWriter fw = null;
		try {
			fw = new FileWriter(new File( propertyFilePath ));
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

	
}
