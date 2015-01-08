package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.sampler.processor.CircleKmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.OctagonKmlGenerator;
import org.openforis.collect.earth.sampler.processor.SquareKmlGenerator;
import org.openforis.collect.earth.sampler.processor.SquareWithCirclesKmlGenerator;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import freemarker.template.TemplateException;

@Component
public class KmlGeneratorService {

	@Autowired
	LocalPropertiesService localPropertiesService;

	Logger logger = LoggerFactory.getLogger(KmlGeneratorService.class);

	public static final String KML_RESULTING_TEMP_FILE = EarthConstants.GENERATED_FOLDER + File.separator + "plots.kml"; //$NON-NLS-1$
	public static final String KMZ_FILE_PATH = EarthConstants.GENERATED_FOLDER + File.separator + "gePlugin.kmz"; //$NON-NLS-1$
	public static final String KML_NETWORK_LINK_TEMPLATE = "resources/loadApp.fmt"; //$NON-NLS-1$
	public static final String KML_NETWORK_LINK_STARTER = EarthConstants.GENERATED_FOLDER + "/loadApp.kml"; //$NON-NLS-1$


	public void generateKmlFile() throws IOException, KmlGenerationException{
		checkFilesExist();
		generatePlacemarksKmzFile();

	}

	private void checkFilesExist() throws KmlGenerationException {

		fixUserDirectory();

		final String csvFilePath = getLocalProperties().getCsvFile();
		final String balloonPath = getLocalProperties().getBalloonFile();
		final String templatePath = getLocalProperties().getTemplateFile();
		boolean filesExist = true;
		String errorMessage = "<html>Error generating the KML file for Google Earth.<br/>"; //$NON-NLS-1$
		File csvFile = null;
		File balloon = null;
		File template = null;
		try {
			csvFile = new File(csvFilePath);
			balloon = new File(balloonPath);
			template = new File(templatePath);
		} catch (final Exception e) {
			logger.error("One of the definition files is not defined", e); //$NON-NLS-1$
		}
		if (csvFile != null && !csvFile.exists()) {
			errorMessage += Messages.getString("EarthApp.21") //$NON-NLS-1$
					+ csvFile.getAbsolutePath() + "</i><br/><br/>"; //$NON-NLS-1$
			filesExist = false;
		} else if (csvFile == null) {
			errorMessage += Messages.getString("EarthApp.23"); //$NON-NLS-1$
			filesExist = false;
		}

		if (template != null && !template.exists()) {
			errorMessage += Messages.getString("EarthApp.24") //$NON-NLS-1$
					+ template.getAbsolutePath() + "</i><br/><br/>"; //$NON-NLS-1$
			filesExist = false;
		} else if (template == null) {
			errorMessage += Messages.getString("EarthApp.26"); //$NON-NLS-1$
			filesExist = false;
		}

		if (balloon != null && !balloon.exists()) {
			errorMessage += Messages.getString("EarthApp.27") + balloon.getAbsolutePath() //$NON-NLS-1$
					+ "</i><br/><br/>"; //$NON-NLS-1$
			filesExist = false;
		} else if (balloon == null) {
			errorMessage += Messages.getString("EarthApp.29"); //$NON-NLS-1$
			filesExist = false;
		}

		errorMessage += Messages.getString("EarthApp.30"); //$NON-NLS-1$

		if( !filesExist ){
			throw new KmlGenerationException(errorMessage);
		}
	}

	private LocalPropertiesService getLocalProperties() {
		return localPropertiesService;
	}

	private void copyContentsToGeneratedFolder(String folderToInclude) throws IOException {
		final File sourceDir = new File(folderToInclude);
		final File targetDir = new File(EarthConstants.GENERATED_FOLDER + File.separator + sourceDir.getName());
		FileUtils.copyDirectory(sourceDir, targetDir);
	}

	private void fixUserDirectory() {
		final String csvFilePath = getLocalProperties().getCsvFile();
		final String balloonPath = getLocalProperties().getBalloonFile();
		final String templatePath = getLocalProperties().getTemplateFile();
		final String metadataPath = getLocalProperties().getImdFile();

		File csvFile = null;
		File balloon = null;
		File template = null;
		File idmFile = null;
		try {
			csvFile = new File(csvFilePath);
			balloon = new File(balloonPath);
			template = new File(templatePath);
			idmFile = new File(metadataPath);

			final String prefixUserFolder = FolderFinder.getLocalFolder() + File.separator;

			if (!csvFile.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getCsvFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.CSV_KEY, otherFile.getAbsolutePath());
				}
			}

			if (!balloon.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getBalloonFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.BALLOON_TEMPLATE_KEY, otherFile.getAbsolutePath());
				}
			}

			if (!template.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getTemplateFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.KML_TEMPLATE_KEY, otherFile.getAbsolutePath());
				}
			}

			if (!idmFile.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getImdFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.METADATA_FILE, otherFile.getAbsolutePath());
				}
			}

		} catch (final Exception e) {
			logger.error("One of the definition files is not defined", e); //$NON-NLS-1$
		}

	}

	public KmlGenerator getKmlGenerator() {
		KmlGenerator generateKml;
		final String crsSystem = getLocalProperties().getCrs();
		final Integer innerPointSide = Integer.parseInt(getLocalProperties().getValue(EarthProperty.INNER_SUBPLOT_SIDE));
		final SAMPLE_SHAPE plotShape = getLocalProperties().getSampleShape();
		final String hostAddress = ServerController.getHostAddress(getLocalProperties().getHost(), getLocalProperties().getPort());
		
		if (plotShape.equals(SAMPLE_SHAPE.CIRCLE)) {
			generateKml = new CircleKmlGenerator(crsSystem, hostAddress, getLocalProperties()
					.getLocalPort(), innerPointSide, Float.parseFloat(getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)));
		} else if (plotShape.equals(SAMPLE_SHAPE.OCTAGON)) {
			generateKml = new OctagonKmlGenerator(crsSystem, hostAddress, getLocalProperties()
					.getLocalPort(), innerPointSide, Float.parseFloat(getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)));
		} else if (plotShape.equals(SAMPLE_SHAPE.SQUARE_CIRCLE)) {
			generateKml = new SquareWithCirclesKmlGenerator(crsSystem, hostAddress,
					getLocalProperties().getLocalPort(), innerPointSide);
		} else {

			final String numberOfSamplingPlots = getLocalProperties().getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT);
			int numberOfSamplingPlotsI = 25;
			if ((numberOfSamplingPlots != null) && (numberOfSamplingPlots.trim().length() > 0)) {
				numberOfSamplingPlotsI = Integer.parseInt(numberOfSamplingPlots.trim());
			}
			generateKml = new SquareKmlGenerator(crsSystem, hostAddress, getLocalProperties()
					.getLocalPort(), innerPointSide, numberOfSamplingPlotsI);
		}
		return generateKml;
	}

	private void generateKml() throws KmlGenerationException, IOException {

		logger.info("START - Generate KML file"); //$NON-NLS-1$
		KmlGenerator generateKml = null;
		generateKml = getKmlGenerator();


		final String csvFile = getLocalProperties().getCsvFile();
		String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();
		final String distanceBetweenSamplePoints = getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS);
		final String distancePlotBoundaries = getLocalProperties().getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES);

		// In case the user sets up the OPEN_BALLOON_IN_FIREFOX flag to
		// true. Meaning that a small ballon opens in the placemark which in
		// its turn
		// opens a firefox browser with the real form
		final Boolean openBalloonInFirefox = Boolean.valueOf(getLocalProperties().getValue(EarthProperty.OPEN_BALLOON_IN_BROWSER));
		if (openBalloonInFirefox) {
			balloon = getLocalProperties().getValue(EarthProperty.ALTERNATIVE_BALLOON_FOR_BROWSER);
		}

		generateKml.generateFromCsv(csvFile, balloon, template, KML_RESULTING_TEMP_FILE, distanceBetweenSamplePoints, distancePlotBoundaries);
		updateFilesUsedChecksum();


		logger.info("END - Generate KML file"); //$NON-NLS-1$

	}

	private void updateFilesUsedChecksum() throws IOException {
		final String csvFile = getLocalProperties().getCsvFile();
		final String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();

		getLocalProperties().saveBalloonFileChecksum(CollectEarthUtils.getMd5FromFile(balloon));
		getLocalProperties().saveCsvFileCehcksum(CollectEarthUtils.getMd5FromFile(csvFile));
		getLocalProperties().saveTemplateFileChecksum(CollectEarthUtils.getMd5FromFile(template));
	}

	public void generateLoaderKmlFile() throws IOException, TemplateException {

		getLocalProperties().saveGeneratedOn(System.currentTimeMillis() + ""); //$NON-NLS-1$

		final Map<String, Object> data = new HashMap<String, Object>();
		data.put("host", ServerController.getHostAddress(getLocalProperties().getHost(), getLocalProperties().getLocalPort())); //$NON-NLS-1$
		data.put("kmlGeneratedOn", getLocalProperties().getGeneratedOn()); //$NON-NLS-1$
		data.put("surveyName", getLocalProperties().getValue(EarthProperty.SURVEY_NAME)); //$NON-NLS-1$
		data.put("plotFileName", KmlGenerator.getCsvFileName(getLocalProperties().getValue(EarthProperty.CSV_KEY))); //$NON-NLS-1$

		FreemarkerTemplateUtils.applyTemplate(new File(KML_NETWORK_LINK_TEMPLATE), new File(KML_NETWORK_LINK_STARTER), data);
	}

	private boolean isKmlUpToDate() throws IOException {

		final String csvFile = getLocalProperties().getCsvFile();
		final String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();

		boolean upToDate = true;
		if (!getLocalProperties().getBalloonFileChecksum().trim().equals(CollectEarthUtils.getMd5FromFile(balloon))
				|| !getLocalProperties().getTemplateFileChecksum().trim().equals(CollectEarthUtils.getMd5FromFile(template))
				|| !getLocalProperties().getCsvFileChecksum().trim().equals(CollectEarthUtils.getMd5FromFile(csvFile))) {
			upToDate = false;
		}

		final File kmzFile = new File(KmlGeneratorService.KMZ_FILE_PATH);
		if (!kmzFile.exists()) {
			upToDate = false;
		}

		return upToDate;

	}

	public void generatePlacemarksKmzFile() throws IOException, KmlGenerationException {

		logger.info("START - Generate KMZ file"); //$NON-NLS-1$

		if (!isKmlUpToDate()) {

			generateKml();

			final KmzGenerator kmzGenerator = new KmzGenerator();

			final String balloon = getLocalProperties().getBalloonFile();
			final File balloonFile = new File(balloon);
			final String folderToInclude = balloonFile.getParent() + File.separator + EarthConstants.FOLDER_COPIED_TO_KMZ;

			kmzGenerator.generateKmzFile(KMZ_FILE_PATH, KML_RESULTING_TEMP_FILE, folderToInclude);
			logger.info("KMZ File generated : " + KMZ_FILE_PATH); //$NON-NLS-1$

			copyContentsToGeneratedFolder(folderToInclude);

			final File kmlFile = new File(KML_RESULTING_TEMP_FILE);
			if (kmlFile.exists()) {
				final boolean deleted = kmlFile.delete();
				if (deleted) {
					logger.info("KML File deleted : " + KML_RESULTING_TEMP_FILE); //$NON-NLS-1$
				} else {
					throw new IOException("The KML file could not be deleted at " + kmlFile.getPath()); //$NON-NLS-1$
				}
			}

		}
		logger.info("END - Generate KMZ file"); //$NON-NLS-1$
	}
}
