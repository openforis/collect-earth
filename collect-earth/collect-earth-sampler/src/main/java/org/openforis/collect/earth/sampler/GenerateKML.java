package org.openforis.collect.earth.sampler;

import java.io.IOException;

import org.apache.log4j.PropertyConfigurator;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.SquareKmlGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import freemarker.template.TemplateException;

public final class GenerateKML {

	public static void main(String[] args) {
		final KmlGenerator generateKml = new SquareKmlGenerator("EPSG:3576", "localhost", "8020", null, 25);
		PropertyConfigurator.configure("./log4j.properties");

		final Logger logger = LoggerFactory.getLogger(GenerateKML.class);

		try {
			final String kmlResult = "resultAnssi.kml";
			generateKml.generateFromCsv("grid-EPSG_3576-mongolia.csv", "balloonWithButtons.html", "anssi_template.fmt", kmlResult, "25", "10");
			final KmzGenerator kmzGenerator = new KmzGenerator();
			kmzGenerator.generateKmzFile("gePlugin.kmz", kmlResult, "files");
		} catch (final IOException e) {
			logger.error("Could not generate KML file", e);
		} catch (final TemplateException e) {
			logger.error("Problems in the Freemarker template file." + e.getFTLInstructionStack(), e);
		}
		System.exit(0);
	}

	private GenerateKML() {
	}
}
