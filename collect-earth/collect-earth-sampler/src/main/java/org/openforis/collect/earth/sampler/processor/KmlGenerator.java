package org.openforis.collect.earth.sampler.processor;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.Vector;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang.StringEscapeUtils;
import org.ietf.jgss.Oid;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.opengis.referencing.operation.TransformException;

import au.com.bytecode.opencsv.CSVReader;
import freemarker.template.TemplateException;

public abstract class KmlGenerator extends AbstractCoordinateCalculation {

	public static CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8")));
		reader = new CSVReader(bufferedReader, ',');
		return reader;
	}

	public static PlotProperties getPlotProperties(String[] csvValuesInLine, String[] possibleColumnNames )  {
		final PlotProperties plotProperties = new PlotProperties();
		plotProperties.id = csvValuesInLine[0];
		plotProperties.xCoord = Double.parseDouble(csvValuesInLine[2]);
		plotProperties.yCoord = Double.parseDouble(csvValuesInLine[1]);
		plotProperties.elevation = 0;
		plotProperties.slope = 0d;
		plotProperties.aspect = 0d;
		
		
		
		Vector<String> extraInfoVector = new Vector<String>();
		if (csvValuesInLine.length > 3) {
			plotProperties.elevation = Integer.parseInt(csvValuesInLine[3]);
			plotProperties.slope = Double.parseDouble(csvValuesInLine[4]);
			plotProperties.aspect = Double.parseDouble(csvValuesInLine[5]);
			if( csvValuesInLine.length > 6 ){
			
				for ( int extraIndex = 6; extraIndex<csvValuesInLine.length; extraIndex++) {
					extraInfoVector.add( StringEscapeUtils.escapeXml( csvValuesInLine[extraIndex]) );
				}
			}
		}
		String[] extraInfoArray = new String[extraInfoVector.size()];
		plotProperties.extraInfo = extraInfoVector.toArray(extraInfoArray);
		
		
		// Adds a map ( coulmnName,cellValue) so that the valeus can also be added to the KML by column name (for the newer versions)
		HashMap<String, String> valuesByColumn = new HashMap<String, String>();
		for (int i = 0; i < possibleColumnNames.length; i++) {
			valuesByColumn.put( possibleColumnNames[i], csvValuesInLine[i]);
		}
		plotProperties.valuesByColumn = valuesByColumn;
		
		return plotProperties;
	}

	private final SimpleDateFormat httpHeaderDf = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz");

	
	public static String getCsvFileName(String csvFilePath) {
		final File csvFile = new File(csvFilePath);
		if (csvFile != null && csvFile.exists()) {
			return csvFile.getName();
		} else {
			return "No CSV file found";
		}

	}

	public static String getHostAddress(String host, String port) {
		String hostAndPort = "";
		if (host != null && host.length() > 0) {
			hostAndPort = host;
			if (port != null && port.length() > 0) {
				hostAndPort += ":" + port;
			}

			hostAndPort = "http://" + hostAndPort + "/earth/";
		}
		return hostAndPort;

	}

	public KmlGenerator(String epsgCode) {
		super(epsgCode);
	}

	

	public void generateFromCsv(String csvFile, String balloonFile, String freemarkerKmlTemplateFile, String destinationKmlFile,
			String distanceBetweenSamplePoints, String distancePlotBoundary) throws IOException, TemplateException {

		try {
			final File destinationFile = new File(destinationKmlFile);
			destinationFile.getParentFile().mkdirs();
			getKmlCode(csvFile, balloonFile, freemarkerKmlTemplateFile, destinationFile, distanceBetweenSamplePoints, distancePlotBoundary);
		} catch (final IOException e) {
			getLogger().error("Could not generate KML file", e);
		}
	}

	public abstract void fillExternalLine(float distanceBetweenSamplePoints, float distancePlotBoundary, double[] coordOriginalPoints,
			SimplePlacemarkObject parentPlacemark) throws TransformException;

	public abstract void fillSamplePoints(float distanceBetweenSamplePoints, double[] coordOriginalPoints, String currentPlaceMarkId,
			SimplePlacemarkObject parentPlacemark) throws TransformException;
	
	private void getKmlCode(String csvFile, String balloonFile, String freemarkerKmlTemplateFile, File destinationFile,
			String distanceBetweenSamplePoints, String distancePlotBoundary) throws IOException, TemplateException {

		final Float fDistancePoints = Float.parseFloat(distanceBetweenSamplePoints);
		final Float fDistancePlotBoundary = Float.parseFloat(distancePlotBoundary);
		
		// Build the data-model
		final Map<String, Object> data = getTemplateData(csvFile, fDistancePoints, fDistancePlotBoundary);
		data.put("expiration", httpHeaderDf.format(new Date()));

		// Get the HTML content of the balloon from a file, this way we can
		// separate the KML generation so it is easier to create different KMLs
		final String balloonContents = FileUtils.readFileToString(new File(balloonFile));
		data.put("html_for_balloon", balloonContents);

		// Process the template file using the data in the "data" Map
		final File templateFile = new File(freemarkerKmlTemplateFile);
		
		FreemarkerTemplateUtils.applyTemplate(templateFile, destinationFile, data);
	}

	protected abstract Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints, float distancePlotBoundary)
			throws IOException;

	
	
}