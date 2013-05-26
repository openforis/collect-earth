package org.openforis.eye.generator.processor;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.StringWriter;
import java.util.Map;

import org.apache.commons.io.FileUtils;
import org.geotools.geometry.jts.JTS;
import org.geotools.referencing.CRS;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.opengis.referencing.crs.CoordinateReferenceSystem;
import org.opengis.referencing.operation.MathTransform;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.vividsolutions.jts.geom.Coordinate;
import com.vividsolutions.jts.geom.GeometryFactory;
import com.vividsolutions.jts.geom.Point;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

public abstract class KmlGenerator {

	protected final Logger logger = LoggerFactory.getLogger(this.getClass());
	private final String epsgCode;

	public KmlGenerator(String epsgCode) {
		super();
		this.epsgCode = epsgCode;
	}

	protected Point latLongToCartesian(double longitude, double latitude) throws Exception {
	
		GeometryFactory gf = new GeometryFactory();
		Coordinate c = new Coordinate(longitude, latitude);
	
		Point p = gf.createPoint(c);
		// EPSG::1164 Mongolia ( ccording to http://www.epsg-registry.org/ )
		CoordinateReferenceSystem utmCrs = CRS.decode(epsgCode);
		MathTransform mathTransform = CRS.findMathTransform(utmCrs, DefaultGeographicCRS.WGS84, false);
		Point p1 = (Point) JTS.transform(p, mathTransform);
		return p1;
	}

	public void generateFromCsv(String csvFile, String ballongFile, String freemarkerKmlTemplateFile, String destinationKmlFile) throws IOException, TemplateException {
		String kml = getKmlCode(csvFile, ballongFile, freemarkerKmlTemplateFile);
	
		File f = new File(destinationKmlFile);
	
		try {
			FileUtils.write(f, kml);
		} catch (IOException e) {
			logger.error("Could not generate KML file", e);
		}
	}

	public String getKmlCode(String csvFile, String ballongFile, String freemarkerKmlTemplateFile) throws IOException, TemplateException {

	
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
	
		return out.toString();
	}

	protected abstract Map<String, Object> getTemplateData(String csvFile) throws FileNotFoundException,
			IOException;

}