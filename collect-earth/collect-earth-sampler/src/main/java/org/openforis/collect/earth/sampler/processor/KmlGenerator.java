package org.openforis.collect.earth.sampler.processor;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Vector;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang.StringEscapeUtils;
import org.apache.commons.lang.StringUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class KmlGenerator extends AbstractCoordinateCalculation {

	private static Logger logger = LoggerFactory.getLogger( KmlGenerator.class);


	public static PlotProperties getPlotProperties(String[] csvValuesInLine, String[] possibleColumnNames, CollectSurvey collectSurvey )   {
		
		List<AttributeDefinition> keyAttributeDefinitions = collectSurvey.getSchema().getRootEntityDefinitions().get(0).getKeyAttributeDefinitions();
		int number_of_key_attributes = keyAttributeDefinitions.size();
		
		final PlotProperties plotProperties = new PlotProperties();
		
		String keys = "";
		for(int i=0; i<number_of_key_attributes; i++){
			keys += csvValuesInLine[i] + ",";
		}
		keys = keys.substring(0, keys.lastIndexOf(','));
		plotProperties.id = keys;

		plotProperties.xCoord = Double.parseDouble(csvValuesInLine[number_of_key_attributes+1].replace(',', '.') );
		plotProperties.yCoord = Double.parseDouble(csvValuesInLine[number_of_key_attributes].replace(',', '.') );
		plotProperties.elevation = 0;
		plotProperties.slope = 0d;
		plotProperties.aspect = 0d;
		
		Vector<String> extraInfoVector = new Vector<String>();
		Vector<String> extraColumns = new Vector<String>();
		if (csvValuesInLine.length > 2 + number_of_key_attributes) {
			
			try{
				plotProperties.elevation = (int) Double.parseDouble(csvValuesInLine[number_of_key_attributes+2].replace(',', '.'));
				plotProperties.slope = Double.parseDouble(csvValuesInLine[number_of_key_attributes+3].replace(',', '.'));
				plotProperties.aspect = Double.parseDouble(csvValuesInLine[number_of_key_attributes+4].replace(',', '.'));
			}catch(Exception e ){
				logger.error("Elevation Slope and Aspect could not be read correctly", e);
			}
			
			if( csvValuesInLine.length > 5 + number_of_key_attributes ){
			
				for ( int extraIndex = 5+number_of_key_attributes; extraIndex<csvValuesInLine.length; extraIndex++) {
					extraInfoVector.add( StringEscapeUtils.escapeXml( csvValuesInLine[extraIndex]) );
				}
			}
			
			// Add all extra columns 
			for ( int extraIndex = 2+number_of_key_attributes; extraIndex < csvValuesInLine.length; extraIndex++) {
				extraColumns.add( StringEscapeUtils.escapeXml( csvValuesInLine[extraIndex]) );
			}
			
		}
		
		
		String[] extraInfoArray = new String[extraInfoVector.size()];
		String[] extraColumnArray = new String[extraColumns.size()];
		String[] idColumnArray = new String[number_of_key_attributes];
		for(int i=0; i<number_of_key_attributes; i++){
			idColumnArray[i] = csvValuesInLine[i];
		}
		
		plotProperties.extraInfo = extraInfoVector.toArray(extraInfoArray);
		plotProperties.extraColumns = extraColumns.toArray(extraColumnArray);
		plotProperties.idColumns = idColumnArray;
		
		// Adds a map ( coulmnName,cellValue) so that the values can also be added to the KML by column name (for the newer versions)
		HashMap<String, String> valuesByColumn = new HashMap<String, String>();
		if( possibleColumnNames != null ){
			for (int i = 0; i < possibleColumnNames.length; i++) {
				valuesByColumn.put( possibleColumnNames[i], csvValuesInLine[i]);
			}
		}
		plotProperties.valuesByColumn = valuesByColumn;
		
		return plotProperties;
	}

	private final SimpleDateFormat httpHeaderDf = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz");
	protected String hostAddress;

	
	public static String getCsvFileName(String csvFilePath) {
		final File csvFile = new File(csvFilePath);
		if (csvFile != null && csvFile.exists()) {
			return csvFile.getName();
		} else {
			return "No CSV file found";
		}
	}

	public KmlGenerator(String epsgCode) {
		super(epsgCode);
	}

	

	public void generateFromCsv(String csvFile, String balloonFile, String freemarkerKmlTemplateFile, String destinationKmlFile,
			String distanceBetweenSamplePoints, String distancePlotBoundary, CollectSurvey collectSurvey) throws KmlGenerationException {

		final File destinationFile = new File(destinationKmlFile);
		destinationFile.getParentFile().mkdirs();
		getKmlCode(csvFile, balloonFile, freemarkerKmlTemplateFile, destinationFile, distanceBetweenSamplePoints, distancePlotBoundary,collectSurvey);
	}

	public abstract void fillExternalLine(double distanceBetweenSamplePoints, double distancePlotBoundary, double[] coordOriginalPoints,
			SimplePlacemarkObject parentPlacemark) throws TransformException;

	public abstract void fillSamplePoints(double distanceBetweenSamplePoints, double[] coordOriginalPoints, String currentPlaceMarkId,
			SimplePlacemarkObject parentPlacemark) throws TransformException;
	
	private void getKmlCode(String csvFile, String balloonFile, String freemarkerKmlTemplateFile, File destinationFile,
			String distanceBetweenSamplePoints, String distancePlotBoundary, CollectSurvey collectSurvey) throws KmlGenerationException {
		
		
		
		if( StringUtils.isBlank(csvFile) ){
			throw new IllegalArgumentException("THe CSV file location cannot be null");
		}
		
		if( StringUtils.isBlank(balloonFile) ){
			throw new IllegalArgumentException("The balloon (Google Earth popup) file location cannot be null");
		}
		
		if( StringUtils.isBlank(freemarkerKmlTemplateFile) ){
			throw new IllegalArgumentException("The KML freemarker Template file location cannot be null");
		}

		final Float fDistancePoints = Float.parseFloat(distanceBetweenSamplePoints);
		final Float fDistancePlotBoundary = Float.parseFloat(distancePlotBoundary);
		
		// Build the data-model
		final Map<String, Object> data = getTemplateData(csvFile, fDistancePoints, fDistancePlotBoundary, collectSurvey);
		data.put("expiration", httpHeaderDf.format(new Date()));

		// Get the HTML content of the balloon from a file, this way we can
		// separate the KML generation so it is easier to create different KMLs
		String balloonContents;
		try {
			balloonContents = FileUtils.readFileToString(new File(balloonFile));
		} catch (IOException e) {
			throw new KmlGenerationException("Error reading the balloon file " + balloonFile,  e);
		}
		try {
			data.put("html_for_balloon", balloonContents);
			data.put("randomNumber", FreemarkerTemplateUtils.randInt(10000, 5000000));

			// Process the template file using the data in the "data" Map
			final File templateFile = new File(freemarkerKmlTemplateFile);
			
			FreemarkerTemplateUtils.applyTemplate(templateFile, destinationFile, data);
		} catch (Exception e) {
			throw new KmlGenerationException("Error generating the KML file to open in Google Earth " + freemarkerKmlTemplateFile + " with data " +  Arrays.toString(data.values().toArray()) ,  e);
		}
	}

	protected abstract Map<String, Object> getTemplateData(String csvFile, double distanceBetweenSamplePoints, double distancePlotBoundary, CollectSurvey collectSurvey)
			throws  KmlGenerationException;

	
	
}