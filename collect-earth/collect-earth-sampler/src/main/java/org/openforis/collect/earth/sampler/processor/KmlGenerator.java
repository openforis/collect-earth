package org.openforis.collect.earth.sampler.processor;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileWriter;
import java.io.IOException;
import java.io.Writer;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Map;

import org.apache.commons.io.FileUtils;
import org.geotools.geometry.jts.JTS;
import org.geotools.referencing.CRS;
import org.geotools.referencing.GeodeticCalculator;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.opengis.referencing.crs.CoordinateReferenceSystem;
import org.opengis.referencing.operation.MathTransform;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.vividsolutions.jts.geom.Coordinate;
import com.vividsolutions.jts.geom.GeometryFactory;
import com.vividsolutions.jts.geom.Point;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

public abstract class KmlGenerator {

	public static final String DEFAULT_HOST = "localhost";
	public static final String DEFAULT_PORT = "80";
	private static final SimpleDateFormat sdf = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz");

	private final GeodeticCalculator calc = new GeodeticCalculator(DefaultGeographicCRS.WGS84);
	private final String epsgCode;
	protected final Logger logger = LoggerFactory.getLogger(this.getClass());

	public KmlGenerator(String epsgCode) {
		super();
		this.epsgCode = epsgCode;
	}

	public void generateFromCsv(String csvFile, String ballongFile, String freemarkerKmlTemplateFile, String destinationKmlFile,
			String distanceBetweenSamplePoints)
 throws IOException, TemplateException {

		try {
			File destinationFile = new File(destinationKmlFile);
			getKmlCode(csvFile, ballongFile, freemarkerKmlTemplateFile, destinationFile, distanceBetweenSamplePoints);
		} catch (IOException e) {
			logger.error("Could not generate KML file", e);
		}
	}

	private void getKmlCode(String csvFile, String ballongFile, String freemarkerKmlTemplateFile, File destinationFile,
			String distanceBetweenSamplePoints)
 throws IOException, TemplateException {

		Float fDistancePoints = Float.parseFloat(distanceBetweenSamplePoints);
		// Build the data-model
		Map<String, Object> data = getTemplateData(csvFile, fDistancePoints);
		data.put("expiration", sdf.format(new Date()));

		// Get the HTML content of the ballong from a file, this way we can
		// separate the KML generation so it is easier to create different KMLs
		String ballongContents = FileUtils.readFileToString(new File(ballongFile));
		data.put("html_for_ballong", ballongContents);

		// Process the template file using the data in the "data" Map
		Configuration cfg = new Configuration();

		// Load template from source folder
		Template template = cfg.getTemplate(freemarkerKmlTemplateFile);

		// Console output
		FileWriter fw = new FileWriter(destinationFile);
		Writer out = new BufferedWriter(fw);
		template.process(data, out);
		out.flush();
		out.close();
		fw.close();

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

	protected double[] getPointWithOffset(double[] originalPoint, double offsetLongitudeMeters, double offsetLatitudeMeters)
			throws TransformException {
		double[] movedPoint = null;
		try {

			if (offsetLatitudeMeters == 0 && offsetLongitudeMeters == 0) {
				movedPoint = originalPoint;
			} else {

				double longitudeDirection = 90; // EAST
				if (offsetLongitudeMeters < 0) {
					longitudeDirection = -90; // WEST
				}

				double latitudeDirection = 0; // NORTH
				if (offsetLatitudeMeters < 0) {
					latitudeDirection = 180; // SOUTH
				}

				calc.setStartingGeographicPoint(originalPoint[0], originalPoint[1]);

				boolean longitudeChanged = false;
				if (offsetLongitudeMeters != 0) {
					calc.setDirection(longitudeDirection, Math.abs(offsetLongitudeMeters));
					longitudeChanged = true;
				}

				if (offsetLatitudeMeters != 0) {
					if (longitudeChanged) {
						double[] firstMove = calc.getDestinationPosition().getCoordinate();
						calc.setStartingGeographicPoint(firstMove[0], firstMove[1]);
					}
					calc.setDirection(latitudeDirection, Math.abs(offsetLatitudeMeters));
				}

				movedPoint = calc.getDestinationPosition().getCoordinate();
			}
		} catch (Exception e) {
			logger.error("Exception when moving point " + Arrays.toString(originalPoint) + " with offset longitude "
					+ offsetLongitudeMeters + " and latitude " + offsetLatitudeMeters, e);
		}
		return movedPoint;

	}

	protected abstract Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints)
			throws FileNotFoundException, IOException;

	protected Point transformToWGS84(double longitude, double latitude) throws Exception {

		GeometryFactory gf = new GeometryFactory();
		Coordinate c = new Coordinate(longitude, latitude);

		Point p = gf.createPoint(c);
		// EPSG::1164 Mongolia ( ccording to http://www.epsg-registry.org/ )
		if (epsgCode.trim().length() > 0 && !epsgCode.equals("LATLONG") && !epsgCode.equals("WGS84")) {
			CoordinateReferenceSystem utmCrs = CRS.decode(epsgCode);
			MathTransform mathTransform = CRS.findMathTransform(utmCrs, DefaultGeographicCRS.WGS84, false);
			p = (Point) JTS.transform(p, mathTransform);
		}
		return p;
	}

}