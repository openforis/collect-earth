package org.openforis.collect.earth.app.service;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Map;

import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.AbstractWgs84Transformer;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.SquareKmlGenerator;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

@Component
public class BingMapService {

	private static final String FREEMARKER_HTML_TEMPLATE = "resources/collectBing.fmt";

	@Autowired
	LocalPropertiesService localPropertiesService;

	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	private Map<String, Object> getPlacemarkData(String[] centerCoordinates){
		final Map<String, Object> data = new HashMap<String, Object>();
		final SimplePlacemarkObject placemark = new SimplePlacemarkObject( centerCoordinates );

		Integer numberOfPoints = Integer.parseInt( localPropertiesService.getValue( EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT) );
		Integer innerPointSide = Integer.parseInt( localPropertiesService.getValue( EarthProperty.INNER_SUBPLOT_SIDE) );
		Float distanceBetweenSamplingPoints = Float.parseFloat( localPropertiesService.getValue( EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS) );
		Float distancePlotBoundary = Float.parseFloat( localPropertiesService.getValue( EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES) );

		SquareKmlGenerator squareKmlGenerator = new SquareKmlGenerator( AbstractWgs84Transformer.WGS84, "", "", innerPointSide, numberOfPoints);
		double[] coords = new double[]{ 
				Double.parseDouble(centerCoordinates[1]),
				Double.parseDouble(centerCoordinates[0]) 
				
		};
		try {
			squareKmlGenerator.fillSamplePoints(distanceBetweenSamplingPoints, coords,"", placemark);
			squareKmlGenerator.fillExternalLine(distanceBetweenSamplingPoints.floatValue(), distancePlotBoundary.floatValue(), coords, placemark);

			data.put("placemark", placemark);
		} catch (TransformException e) {
			logger.error( "Exception producing Bing map data for html ", e );
		}
		return data;
	}


	public String getTemporaryUrl(String[] centerCoordinates){

		Map data = getPlacemarkData(centerCoordinates);
		File transformedHtml = null;
		try {
			transformedHtml = applyData(data);
		} catch (Exception e) {
			logger.error( "Exception when applying template for Bing map", e );
		}
		if( transformedHtml!= null ){
			return transformedHtml.getAbsolutePath();
		}else 
			return null;
		
	}


	private File applyData(Map data) throws IOException, TemplateException{

		// Process the template file using the data in the "data" Map
		final Configuration cfg = new Configuration();
		final File templateFile = new File(KmlGenerator.convertToOSPath(FREEMARKER_HTML_TEMPLATE));
		cfg.setDirectoryForTemplateLoading(templateFile.getParentFile());

		// Load template from source folder
		final Template template = cfg.getTemplate(templateFile.getName());

		File tempFile = File.createTempFile("bing", "html");
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

}
