package org.openforis.collect.earth.sampler.processor;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.StringWriter;
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

	private final GeodeticCalculator calc = new GeodeticCalculator(DefaultGeographicCRS.WGS84);
	private final String epsgCode;
	protected final Logger logger = LoggerFactory.getLogger(this.getClass());

	public KmlGenerator(String epsgCode) {
		super();
		this.epsgCode = epsgCode;
	}

	public void generateFromCsv(String csvFile, String ballongFile, String freemarkerKmlTemplateFile, String destinationKmlFile)
			throws IOException, TemplateException {
		String kml = getKmlCode(csvFile, ballongFile, freemarkerKmlTemplateFile);
		File f = new File(destinationKmlFile);
		try {
			FileUtils.write(f, kml);
		} catch (IOException e) {
			logger.error("Could not generate KML file", e);
		}
	}

	public String getKmlCode(String csvFile, String ballongFile, String freemarkerKmlTemplateFile) throws IOException,
			TemplateException {

		// Build the data-model
		Map<String, Object> data = getTemplateData(csvFile);

		// Get the HTML content of the ballong from a file, this way we can
		// separate the KML generation so it is easier to create different KMLs
		String ballongContents = FileUtils.readFileToString(new File(ballongFile));
		data.put("html_for_ballong", ballongContents);

		// Process the template file using the data in the "data" Map
		Configuration cfg = new Configuration();

		// Load template from source folder
		Template template = cfg.getTemplate(freemarkerKmlTemplateFile);

		// Console output
		StringWriter out = new StringWriter();
		template.process(data, out);
		out.flush();
		// return out.toString().replaceAll(">\\s*<", "><");
		return out.toString();

	}

	protected double[] getPointWithOffset(double[] originalPoint, double offsetLongitudeMeters, double offsetLatitudeMeters)
			throws TransformException {
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

		return calc.getDestinationPosition().getCoordinate();

	}

	protected abstract Map<String, Object> getTemplateData(String csvFile) throws FileNotFoundException, IOException;

	protected Point transformToWGS84(double longitude, double latitude) throws Exception {

		GeometryFactory gf = new GeometryFactory();
		Coordinate c = new Coordinate(longitude, latitude);

		Point p = gf.createPoint(c);
		// EPSG::1164 Mongolia ( ccording to http://www.epsg-registry.org/ )
		CoordinateReferenceSystem utmCrs = CRS.decode(epsgCode);
		MathTransform mathTransform = CRS.findMathTransform(utmCrs, DefaultGeographicCRS.WGS84, false);
		Point p1 = (Point) JTS.transform(p, mathTransform);
		return p1;
	}

}