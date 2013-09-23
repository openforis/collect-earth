package org.openforis.collect.earth.sampler.processor;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.Charset;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Map;

import org.apache.commons.io.FileUtils;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

public abstract class KmlGenerator extends AbstractWgs84Transformer {

	public static final String DEFAULT_HOST = "localhost";
	public static final String DEFAULT_PORT = "80";
	private final SimpleDateFormat httpHeaderDf = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz");

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
			File destinationFile = new File(destinationKmlFile);
			getKmlCode(csvFile, balloonFile, freemarkerKmlTemplateFile, destinationFile, distanceBetweenSamplePoints,
					distancePlotBoundary);
		} catch (IOException e) {
			getLogger().error("Could not generate KML file", e);
		}
	}

	private void getKmlCode(String csvFile, String balloonFile, String freemarkerKmlTemplateFile, File destinationFile,
			String distanceBetweenSamplePoints, String distancePlotBoundary) throws IOException, TemplateException {

		Float fDistancePoints = Float.parseFloat(distanceBetweenSamplePoints);
		Float fDistancePlotBoundary = Float.parseFloat(distancePlotBoundary);
		// Build the data-model
		Map<String, Object> data = getTemplateData(csvFile, fDistancePoints, fDistancePlotBoundary);
		data.put("expiration", httpHeaderDf.format(new Date()));

		// Get the HTML content of the balloon from a file, this way we can
		// separate the KML generation so it is easier to create different KMLs
		String balloonContents = FileUtils.readFileToString(new File(balloonFile));
		data.put("html_for_balloon", balloonContents);

		// Process the template file using the data in the "data" Map
		Configuration cfg = new Configuration();

		// Load template from source folder
		Template template = cfg.getTemplate(freemarkerKmlTemplateFile);

		// Console output
		BufferedWriter fw = null;
		try {
			fw = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(destinationFile), Charset.forName("UTF-8")));

			template.process(data, fw);
		} catch (Exception e) {
			getLogger().error("Error writing KML file", e);
		} finally {
			if (fw != null) {
				fw.close();
			}
		}

	}


	protected abstract Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints,
			float distancePlotBoundary) throws IOException;

}