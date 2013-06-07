package org.openforis.collect.earth.sampler;

import java.io.IOException;

import org.apache.log4j.PropertyConfigurator;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.MultiPointKmlGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import freemarker.template.TemplateException;

public class GenerateKML {
	private static final Logger logger = LoggerFactory.getLogger(GenerateKML.class);

	public static void main(String[] args) {
		// KmlGenerator generateKml = new OnePointKmlGenerator();
		KmlGenerator generateKml = new MultiPointKmlGenerator("EPSG:3576");
		PropertyConfigurator.configure("./log4j.properties");

		try {
			String kmlResult = "resultAnssi.kml";
			generateKml
					.generateFromCsv("grid-EPSG_3576-mongolia.csv", "balloonWithButtons.html", "anssi_template.fmt", kmlResult);
			KmzGenerator.generateKmzFile("gePlugin.kmz", kmlResult, "files");
		} catch (IOException e) {
			logger.error("Could not generate KML file", e);
		} catch (TemplateException e) {
			logger.error("Problems in the Freemarker template file." + e.getFTLInstructionStack(), e);
		}
		System.exit(0);
	}
}
