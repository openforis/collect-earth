package org.openforis.collect.earth.sampler.utils;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.Map;
import java.util.Random;
import java.util.function.UnaryOperator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import freemarker.cache.FileTemplateLoader;
import freemarker.cache.MultiTemplateLoader;
import freemarker.cache.StringTemplateLoader;
import freemarker.cache.TemplateLoader;
import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;
import freemarker.template.Version;


public class FreemarkerTemplateUtils {

	private static final Logger logger = LoggerFactory.getLogger(FreemarkerTemplateUtils.class);

	private static final Random rand = new SecureRandom();

	private FreemarkerTemplateUtils() {}

	public static boolean applyTemplate(File sourceTemplate, File destinationFile, Map<?, ?> data) throws IOException, TemplateException{
		return applyTemplate(sourceTemplate, destinationFile, data, null);
	}

	/**
	 * @param transformSource applied to the text of the template before it is processed, or null to process the file as it
	 *        is. The file itself is never written to: a template that the transformation changed is processed from memory,
	 *        with the folder of the original behind it so that whatever it includes still resolves.
	 */
	public static boolean applyTemplate(File sourceTemplate, File destinationFile, Map<?, ?> data, UnaryOperator<String> transformSource) throws IOException, TemplateException{

		// Process the template file using the data in the "data" Map
		final Configuration cfg = new Configuration( new Version("2.3.23"));
		cfg.setTemplateLoader(buildTemplateLoader(sourceTemplate, transformSource));

		// Load the template from the source folder BEFORE opening the destination file : opening it truncates it, so a template that
		// cannot be read used to leave an empty KML behind that was reported as generated
		final Template template = cfg.getTemplate(sourceTemplate.getName());

		// Console output
		try ( BufferedWriter fw = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(destinationFile), StandardCharsets.UTF_8 ) ) ) {
			template.process(data, fw);
		}
		logger.info("Kml file processed {}", destinationFile);
		return true;

	}

	private static TemplateLoader buildTemplateLoader(File sourceTemplate, UnaryOperator<String> transformSource) throws IOException {
		final FileTemplateLoader fromFolder = new FileTemplateLoader(sourceTemplate.getParentFile());
		if (transformSource == null) {
			return fromFolder;
		}

		// Read with the charset Freemarker itself would use for the file, so that a template written in the encoding of the
		// machine keeps rendering exactly as it did before
		final String source = new String(Files.readAllBytes(sourceTemplate.toPath()), Charset.defaultCharset());
		final String transformed = transformSource.apply(source);
		if (transformed.equals(source)) {
			return fromFolder;
		}

		final StringTemplateLoader inMemory = new StringTemplateLoader();
		inMemory.putTemplate(sourceTemplate.getName(), transformed);
		// The folder stays behind it: only this one template comes from memory, everything it includes is still read from disk
		return new MultiTemplateLoader(new TemplateLoader[] { inMemory, fromFolder });
	}

	/**
	 * Returns a pseudo-random number between min and max, inclusive.
	 * The difference between min and max can be at most
	 * <code>Integer.MAX_VALUE - 1</code>.
	 *
	 * @param min Minimum value
	 * @param max Maximum value.  Must be greater than min.
	 * @return Integer between min and max, inclusive.
	 * @see java.util.Random#nextInt(int)
	 */
	public static int randInt(int min, int max) {
		// nextInt is normally exclusive of the top value,
		// so add 1 to make it inclusive
		return rand.nextInt((max - min) + 1) + min;
	}



}
