package org.openforis.collect.earth.sampler.processor;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.Charset;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Map;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.sampler.model.AspectCode;

import au.com.bytecode.opencsv.CSVReader;
import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

public abstract class KmlGenerator extends AbstractWgs84Transformer {

	public static final String DEFAULT_HOST = "localhost";
	public static final String DEFAULT_PORT = "80";
	private final SimpleDateFormat httpHeaderDf = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz");
	private static final String pathSeparator = File.separator;

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
	

	public static String getCsvFileName( String csvFilePath) {
		File csvFile = new File(csvFilePath);
		if( csvFile != null && csvFile.exists() ){
			return csvFile.getName();
		}else{
			return "No CSV file found";
		}
		
	}

	public KmlGenerator(String epsgCode) {
		super(epsgCode);
	}
	
	protected AspectCode getHumanReadableAspect(Double aspect) {
		double aspectProc = aspect + 22.5;
		if( aspectProc >= 360d){
			aspectProc = aspectProc - 360;
		}
		int modulo = (int) Math.floor( aspectProc / 45d) ;
		return AspectCode.values()[ modulo];
	}


	private String convertToOSPath(String path) {
		path = path.replace("/", pathSeparator);
		path = path.replace("\\", pathSeparator);
		return path;
	}

	public void generateFromCsv(String csvFile, String balloonFile, String freemarkerKmlTemplateFile, String destinationKmlFile,
			String distanceBetweenSamplePoints, String distancePlotBoundary) throws IOException, TemplateException {

		try {
			File destinationFile = new File(convertToOSPath(destinationKmlFile));
			destinationFile.getParentFile().mkdirs();
			getKmlCode(csvFile, balloonFile, freemarkerKmlTemplateFile, destinationFile, distanceBetweenSamplePoints, distancePlotBoundary);
		} catch (IOException e) {
			getLogger().error("Could not generate KML file", e);
		}
	}

	public static CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8")));
		reader = new CSVReader(bufferedReader, ',');
		return reader;
	}

	private void getKmlCode(String csvFile, String balloonFile, String freemarkerKmlTemplateFile, File destinationFile,
			String distanceBetweenSamplePoints, String distancePlotBoundary) throws IOException, TemplateException {

		Float fDistancePoints = Float.parseFloat(distanceBetweenSamplePoints);
		Float fDistancePlotBoundary = Float.parseFloat(distancePlotBoundary);
		// Build the data-model
		Map<String, Object> data = getTemplateData(convertToOSPath(csvFile), fDistancePoints, fDistancePlotBoundary);
		data.put("expiration", httpHeaderDf.format(new Date()));

		// Get the HTML content of the balloon from a file, this way we can
		// separate the KML generation so it is easier to create different KMLs
		String balloonContents = FileUtils.readFileToString(new File(convertToOSPath(balloonFile)));
		data.put("html_for_balloon", balloonContents);

		// Process the template file using the data in the "data" Map
		Configuration cfg = new Configuration();
		File templateFile = new File(convertToOSPath(freemarkerKmlTemplateFile));
		cfg.setDirectoryForTemplateLoading(templateFile.getParentFile());

		// Load template from source folder
		Template template = cfg.getTemplate(templateFile.getName());

		// Console output
		BufferedWriter fw = null;
		try {
			fw = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(destinationFile), Charset.forName("UTF-8")));

			template.process(data, fw);
		} finally {
			if (fw != null) {
				fw.close();
			}
		}

	}

	public static PlotProperties getPlotProperties(String[] csvValuesInLine) {
		PlotProperties plotProperties = new PlotProperties();
		plotProperties.id = csvValuesInLine[0];
		plotProperties.xCoord = Double.parseDouble(csvValuesInLine[1]);
		plotProperties.yCoord = Double.parseDouble(csvValuesInLine[2]);
		plotProperties.elevation = 0;
		plotProperties.slope = 0d;
		plotProperties.aspect = 0d;
		if (csvValuesInLine.length > 3) {
			plotProperties.elevation = Integer.parseInt(csvValuesInLine[3]);
			plotProperties.slope = Double.parseDouble(csvValuesInLine[4]);
			plotProperties.aspect = Double.parseDouble(csvValuesInLine[5]);
		}
		return plotProperties;
	}

	protected abstract Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints, float distancePlotBoundary)
			throws IOException;

}