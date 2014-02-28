package org.openforis.collect.earth.app.service;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Map;

import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

/**
 * Customizes a Bing Map page to open zoomed into a coordinate. The HTML page is created in a temporary file and its URL is returned so that it can be opened in a browser.
 * A freemarker template that contains the javascript code to customize the Bing Map is used and the parameters for the specific coordinates are applied to it.
 * This service uses the same code than the KML generator to get the plot sample deign as chosen through the configuration by the user.
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Component
public class BingMapService {

	/**
	 * The file that contains the freemarker template used to produce the Bing Maps code.
	 */
	private static final String FREEMARKER_HTML_TEMPLATE = "resources/collectBing.fmt";

	@Autowired
	LocalPropertiesService localPropertiesService;

	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	private File applyData(Map<String,Object>  data) throws IOException, TemplateException {

		// Process the template file using the data in the "data" Map
		final Configuration cfg = new Configuration();
		final File templateFile = new File(KmlGenerator.convertToOSPath(FREEMARKER_HTML_TEMPLATE));
		cfg.setDirectoryForTemplateLoading(templateFile.getParentFile());

		// Load template from source folder
		final Template template = cfg.getTemplate(templateFile.getName());

		final File tempFile = File.createTempFile("bing", ".html");
		tempFile.deleteOnExit();
		// Console output
		BufferedWriter fw = null;
		try {
			fw = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(tempFile), Charset.forName("UTF-8")));
			template.process(data, fw);
		} finally {
			if (fw != null) {
				fw.close();
			}
		}

		return tempFile;

	}

	private Map<String, Object> getPlacemarkData(String[] centerLatLong) {
		final Map<String, Object> data = new HashMap<String, Object>();
		final SimplePlacemarkObject placemark = new SimplePlacemarkObject(centerLatLong);

		final Float distanceBetweenSamplingPoints = Float.parseFloat(localPropertiesService.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS));
		final Float distancePlotBoundary = Float.parseFloat(localPropertiesService.getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES));

		KmlGenerator kmlGenerator = EarthApp.getKmlGenerator(localPropertiesService);
		
		final double[] centerLatLongD = new double[] { Double.parseDouble(centerLatLong[0]), Double.parseDouble(centerLatLong[1])};
		
		try {
			kmlGenerator.fillSamplePoints(distanceBetweenSamplingPoints, centerLatLongD, "", placemark);
			kmlGenerator.fillExternalLine(distanceBetweenSamplingPoints.floatValue(), distancePlotBoundary.floatValue(), centerLatLongD,
					placemark);

			data.put("placemark", placemark);
		} catch (final TransformException e) {
			logger.error("Exception producing Bing map data for html ", e);
		}
		return data;
	}

	/**
	 * Produces a temporary file with the necessary HTML code to show the plot in Bing Maps
	 * @param centerCoordinates The coordinates of the center of the plot.
	 * @return The URL to the temporary file that can be used to load it in a browser.
	 */
	public String getTemporaryUrl(String[] centerCoordinates) {

		final Map<String,Object> data = getPlacemarkData(centerCoordinates);
		File transformedHtml = null;
		try {
			transformedHtml = applyData(data);
		} catch (final Exception e) {
			logger.error("Exception when applying template for Bing map", e);
		}
		if (transformedHtml != null) {
			return transformedHtml.getAbsolutePath();
		} else {
			return null;
		}

	}

}
