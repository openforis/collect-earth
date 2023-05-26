package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.processor.CircleKmlGenerator;
import org.openforis.collect.earth.sampler.processor.HexagonKmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.NfiFourCirclesGenerator;
import org.openforis.collect.earth.sampler.processor.NfiThreeCirclesGenerator;
import org.openforis.collect.earth.sampler.processor.NfmaKmlGenerator;
import org.openforis.collect.earth.sampler.processor.PolygonGeojsonGenerator;
import org.openforis.collect.earth.sampler.processor.PolygonKmlGenerator;
import org.openforis.collect.earth.sampler.processor.PolygonWktGenerator;
import org.openforis.collect.earth.sampler.processor.SquareKmlGenerator;
import org.openforis.collect.earth.sampler.processor.SquareWithCirclesKmlGenerator;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.opencsv.CSVReader;
import com.opencsv.exceptions.CsvValidationException;

import freemarker.template.TemplateException;

@Component
public class KmlGeneratorService {

	@Autowired
	LocalPropertiesService localPropertiesService;

	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	DataImportExportService dataImportExportService;

	Logger logger = LoggerFactory.getLogger(KmlGeneratorService.class);

	private static final String RESOURCES_FOLDER = "resources";

	public static final String KML_RESULTING_TEMP_FILE = EarthConstants.GENERATED_FOLDER + File.separator + "plots.kml"; //$NON-NLS-1$
	public static final String KMZ_FILE_PATH = EarthConstants.GENERATED_FOLDER + File.separator + "gePlugin.kmz"; //$NON-NLS-1$
	public static final String KML_NETWORK_LINK_TEMPLATE = RESOURCES_FOLDER + File.separator + "loadApp.fmt"; //$NON-NLS-1$
	public static final String KML_NETWORK_LINK_STARTER = EarthConstants.GENERATED_FOLDER + "/loadApp.kml"; //$NON-NLS-1$

	public static final String FREEMARKER_KML_OUTPUT_TEMPLATE_BALLOON = RESOURCES_FOLDER + File.separator
			+ "balloonForKMLExport.fmt";
	public static final String FREEMARKER_KML_OUTPUT_TEMPLATE_KML = RESOURCES_FOLDER + File.separator
			+ "kmlForKMLExport.fmt";

	public static interface PolygonTest {
		Boolean isPolygon(String[] strColumns);
	}

	public void generateKmlFile() throws IOException, KmlGenerationException, CsvValidationException {
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

		if (!filesExist) {
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

			final String prefixUserFolder = FolderFinder.getCollectEarthDataFolder() + File.separator;

			if (!csvFile.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getCsvFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.SAMPLE_FILE, otherFile.getAbsolutePath());
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

	private int parseInt(String intNumber) {
		int i = 0;
		try {
			if (StringUtils.isNoneBlank(intNumber)) {
				i = Integer.parseInt(intNumber);
			}
		} catch (Exception e) {
			logger.error("Error parsing integer number");
		}
		return i;
	}

	public KmlGenerator getKmlGenerator() throws KmlGenerationException, CsvValidationException {
		KmlGenerator generateKml = null;

		final String crsSystem = getLocalProperties().getCrs();
		final Integer innerPointSide = parseInt(getLocalProperties().getValue(EarthProperty.INNER_SUBPLOT_SIDE));
		final Integer largeCentralPlotSide = parseInt(
				getLocalProperties().getValue(EarthProperty.LARGE_CENTRAL_PLOT_SIDE));
		final String distanceToBuffers = getLocalProperties().getValue(EarthProperty.DISTANCE_TO_BUFFERS);
		SAMPLE_SHAPE plotShape = getLocalProperties().getSampleShape();
		final String hostAddress = ServerController.getHostAddress(getLocalProperties().getHost(),
				getLocalProperties().getPort());

		final float distanceBetweenSamplePoints;
		final float distanceToPlotBoundaries;
		String dBSP = getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS);
		try {
			distanceBetweenSamplePoints = Float.parseFloat(dBSP);
		} catch (Exception e) {
			logger.error("Error parsing distance between sample points , wrong value : " + dBSP, e);
			EarthApp.showMessage(
					"Attention: Check earth.properties file. The distance between sample points must be a number! You have set it to : " //$NON-NLS-1$
							+ dBSP);
			return null;
		}

		String dToPlotB = getLocalProperties().getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES);
		try {
			distanceToPlotBoundaries = Float.parseFloat(dToPlotB);
		} catch (Exception e) {
			logger.error("Error parsing distance between plots , wrong value : " + dToPlotB, e);
			EarthApp.showMessage(
					"Attention: Check earth.properties file. The distance between sample point and border of the plot must be a number ! You have set it to : " //$NON-NLS-1$
							+ dToPlotB);
			return null;
		}
		final String localPort = getLocalProperties().getLocalPort();
		final String numberOfSamplingPlots = getLocalProperties()
				.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT);
		final String csvFile = getLocalProperties().getCsvFile();

		int numberOfPoints = 25;
		if ((numberOfSamplingPlots != null) && (numberOfSamplingPlots.trim().length() > 0)) {
			numberOfPoints = parseInt(numberOfSamplingPlots.trim());
		}

		try {
			// If there is a polygon column then the type of plot shape is assumed to be
			// POLYGON
			if (csvContainsKml(csvFile)) {
				plotShape = SAMPLE_SHAPE.KML_POLYGON;
			} else if (csvContainsWkt(csvFile)) {
				plotShape = SAMPLE_SHAPE.WKT_POLYGON;
			} else if (csvContainsGeoJson(csvFile)) {
				plotShape = SAMPLE_SHAPE.GEOJSON_POLYGON;
			}

			if (plotShape.equals(SAMPLE_SHAPE.CIRCLE)) {
				generateKml = new CircleKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide, numberOfPoints,
						distanceBetweenSamplePoints);
			} else if (plotShape.equals(SAMPLE_SHAPE.NFMA)) {
				generateKml = new NfmaKmlGenerator(crsSystem, hostAddress, localPort, 150, false);
			} else if (plotShape.equals(SAMPLE_SHAPE.NFMA_250)) {
				generateKml = new NfmaKmlGenerator(crsSystem, hostAddress, localPort, 250, true);
			} else if (plotShape.equals(SAMPLE_SHAPE.NFI_THREE_CIRCLES)) {

				String dBP = getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_PLOTS);
				float distanceBetweenPlots;
				try {
					distanceBetweenPlots = Float.parseFloat(dBP);
				} catch (Exception e) {
					logger.error("Error parsing distance between plots , wrong value : " + dBP, e);
					EarthApp.showMessage(
							"Attention: Check earth.properties file. The distance between plots must be a number! You have set it to : " //$NON-NLS-1$
									+ dBP);
					return null;
				}

				generateKml = new NfiThreeCirclesGenerator(crsSystem, hostAddress, localPort, innerPointSide,
						distanceBetweenSamplePoints, distanceBetweenPlots);
			} else if (plotShape.equals(SAMPLE_SHAPE.NFI_FOUR_CIRCLES)) {

				String dBP = getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_PLOTS);
				float distanceBetweenPlots;
				try {
					distanceBetweenPlots = Float.parseFloat(dBP);
				} catch (Exception e) {
					logger.error(String.format("Error parsing distance between plots , wrong value : %s", dBP), e);
					EarthApp.showMessage(
							"Attention: Check earth.properties file. The distance between plots must be a number! You have set it to : " //$NON-NLS-1$
									+ dBP);
					return null;
				}

				generateKml = new NfiFourCirclesGenerator(crsSystem, hostAddress, localPort, innerPointSide,
						distanceBetweenSamplePoints, distanceBetweenPlots);
			} else if (plotShape.equals(SAMPLE_SHAPE.HEXAGON)) {
				generateKml = new HexagonKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide, numberOfPoints,
						distanceBetweenSamplePoints);
			} else if (plotShape.equals(SAMPLE_SHAPE.SQUARE_CIRCLE)) {
				generateKml = new SquareWithCirclesKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide,
						numberOfPoints, distanceBetweenSamplePoints, distanceToPlotBoundaries);
			} else if (plotShape.equals(SAMPLE_SHAPE.KML_POLYGON)) {
				generateKml = new PolygonKmlGenerator(crsSystem, hostAddress, localPort);
			} else if (plotShape.equals(SAMPLE_SHAPE.GEOJSON_POLYGON)) {
				generateKml = new PolygonGeojsonGenerator(crsSystem, hostAddress, localPort);
			} else if (plotShape.equals(SAMPLE_SHAPE.WKT_POLYGON)) {
				generateKml = new PolygonWktGenerator(crsSystem, hostAddress, localPort);
			} else {
				generateKml = new SquareKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide, numberOfPoints,
						distanceBetweenSamplePoints, distanceToPlotBoundaries, largeCentralPlotSide, distanceToBuffers);
			}
		} catch (IOException e) {
			logger.error("Error generating KML", e);
		}

		if (generateKml == null) {
			throw new KmlGenerationException("Error getting the KML generator for parameters " + plotShape.name());
		}

		return generateKml;
	}

	private boolean csvContains(String csvFile, PolygonTest test) throws IOException, CsvValidationException {
		try (CSVReader csvReader = CsvReaderUtils.getCsvReader(csvFile)) {
			csvReader.readNext(); // Ignore it might be the column headers

			String[] secondLine = csvReader.readNext();
			if (secondLine != null && !CsvReaderUtils.onlyEmptyCells(secondLine)) {
				return test.isPolygon(secondLine);
			}

			return false;
		}
	}

	private boolean csvContainsGeoJson(String csvFile) throws IOException, CsvValidationException {
		return csvContains(csvFile, csvColumns -> new PolygonGeojsonGenerator(null, null, null)
				.isGeoJsonPolygonColumnFound(csvColumns) != null);
	}

	private boolean csvContainsWkt(String csvFile) throws IOException, CsvValidationException {
		return csvContains(csvFile,
				csvColumns -> new PolygonWktGenerator(null, null, null).isWktPolygonColumnFound(csvColumns) != null);
	}

	private boolean csvContainsKml(String csvFile) throws IOException, CsvValidationException {
		return csvContains(csvFile,
				csvColumns -> new PolygonKmlGenerator(null, null, null).isKmlPolygonColumnFound(csvColumns) != null);
	}

	private void generateKml() throws KmlGenerationException, IOException, CsvValidationException {

		KmlGenerator kmlGenerator = null;
		kmlGenerator = getKmlGenerator();

		if (kmlGenerator == null) {
			throw new KmlGenerationException("Error while generating KML");
		}

		final String csvFile = getLocalProperties().getCsvFile();
		String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();

		// In case the user sets up the OPEN_BALLOON_IN_FIREFOX flag to
		// true. Meaning that a small ballon opens in the placemark which in
		// its turn
		// opens a firefox browser with the real form
		final Boolean openBalloonInFirefox = Boolean
				.valueOf(getLocalProperties().getValue(EarthProperty.OPEN_BALLOON_IN_BROWSER));
		if (Boolean.TRUE.equals(openBalloonInFirefox)) {
			String alternativeBalloon = getLocalProperties().getValue(EarthProperty.ALTERNATIVE_BALLOON_FOR_BROWSER);
			if (!StringUtils.isBlank(alternativeBalloon)) {
				balloon = alternativeBalloon;
			}
		}

		// Using all of the files that compose the final KML it is generated and stores
		// in KML_RESULTING_TEMP_FILE
		kmlGenerator.generateKmlFile(KML_RESULTING_TEMP_FILE, csvFile, balloon, template,
				earthSurveyService.getCollectSurvey(), false);
		updateFilesUsedChecksum();

	}

	public void exportToKml(File exportToFile) throws Exception {

		KmlGenerator kmlGenerator = null;
		kmlGenerator = getKmlGenerator();

		if (kmlGenerator == null) {
			throw new KmlGenerationException("Error while generating KML");
		}

		File csvTempFile = File.createTempFile("surveyData",  "csv");
		csvTempFile.deleteOnExit();
		dataImportExportService.exportSurveyAsCsv(csvTempFile, false).startProcessing(); // Get the CSV with the data
																							// collected!
		
		try( BufferedReader brCsvReader = new BufferedReader(new FileReader(csvTempFile)) ){
			String headerLine = brCsvReader.readLine();
			headerLine = headerLine.replaceAll("\"", ""); // remove the quotes that are used in the CSV
			String[] headers = headerLine.split(",");
			File balloonFile = generateKmlExportBallonFile(headers); // get an HTML balloon template that matches the survey
	
			// Using all of the files that compose the final KML it is generated and stores
			// in KML_RESULTING_TEMP_FILE
			kmlGenerator.generateKmlFile(exportToFile.getAbsolutePath(), csvTempFile.getAbsolutePath(), balloonFile.getAbsolutePath(), FREEMARKER_KML_OUTPUT_TEMPLATE_KML,
					earthSurveyService.getCollectSurvey(), true);
		}
	}

	private File generateKmlExportBallonFile(String[] attributeNames) throws KmlGenerationException, IOException {
		// Build the data-model
		final Map<String, Object> data = new HashMap<>();

		data.put("attributes", attributeNames);
		File destniationFileTemp = null;
		try {

			destniationFileTemp = File.createTempFile("TempBalloonForKML", "html");

			// Process the template file using the data in the "data" Map
			final File templateFile = new File(FREEMARKER_KML_OUTPUT_TEMPLATE_BALLOON);

			FreemarkerTemplateUtils.applyTemplate(templateFile, destniationFileTemp, data);

		} catch (Exception e) {
			throw new KmlGenerationException("Error generating the KML file to open in Google Earth "
					+ FREEMARKER_KML_OUTPUT_TEMPLATE_BALLOON + " with data " + Arrays.toString(data.values().toArray()), e);
		}
		return destniationFileTemp;

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

		final Map<String, Object> data = new HashMap<>();
		data.put("host", //$NON-NLS-1$
				ServerController.getHostAddress(getLocalProperties().getHost(), getLocalProperties().getLocalPort()));
		data.put("kmlGeneratedOn", getLocalProperties().getGeneratedOn()); //$NON-NLS-1$
		data.put("surveyName", getLocalProperties().getValue(EarthProperty.SURVEY_NAME)); //$NON-NLS-1$
		data.put("plotFileName", KmlGenerator.getCsvFileName(getLocalProperties().getValue(EarthProperty.SAMPLE_FILE))); //$NON-NLS-1$

		FreemarkerTemplateUtils.applyTemplate(new File(KML_NETWORK_LINK_TEMPLATE), new File(KML_NETWORK_LINK_STARTER),
				data);
	}

	private boolean isKmlUpToDate() throws IOException {

		final String csvFile = getLocalProperties().getCsvFile();
		final String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();

		boolean upToDate = true;
		if (!getLocalProperties().getBalloonFileChecksum().trim().equals(CollectEarthUtils.getMd5FromFile(balloon))
				|| !getLocalProperties().getTemplateFileChecksum().trim()
						.equals(CollectEarthUtils.getMd5FromFile(template))
				|| !getLocalProperties().getCsvFileChecksum().trim()
						.equals(CollectEarthUtils.getMd5FromFile(csvFile))) {
			upToDate = false;
		}

		final File kmzFile = new File(KmlGeneratorService.KMZ_FILE_PATH);
		if (!kmzFile.exists()) {
			upToDate = false;
		}

		return upToDate;

	}

	public void generatePlacemarksKmzFile() throws IOException, KmlGenerationException, CsvValidationException {
		generatePlacemarksKmzFile(false);
	}

	public void generatePlacemarksKmzFile(boolean forceRegeneration)
			throws IOException, KmlGenerationException, CsvValidationException {

		logger.info("START - Generate KMZ file"); //$NON-NLS-1$

		if (forceRegeneration || !isKmlUpToDate()) {

			generateKml();

			final KmzGenerator kmzGenerator = new KmzGenerator();

			final String balloon = getLocalProperties().getBalloonFile();
			final File balloonFile = new File(balloon);
			final String folderToInclude = balloonFile.getParent() + File.separator
					+ EarthConstants.FOLDER_COPIED_TO_KMZ;

			kmzGenerator.generateKmzFile(KMZ_FILE_PATH, KML_RESULTING_TEMP_FILE, folderToInclude);
			logger.info("KMZ File generated : {}", KMZ_FILE_PATH); //$NON-NLS-1$

			copyContentsToGeneratedFolder(folderToInclude);

			final File kmlFile = new File(KML_RESULTING_TEMP_FILE);
			if (kmlFile.exists()) {
				final boolean deleted = kmlFile.delete();
				if (deleted) {
					logger.info("KML File deleted : {}", KML_RESULTING_TEMP_FILE); //$NON-NLS-1$
				} else {
					throw new IOException("The KML file could not be deleted at " + kmlFile.getPath()); //$NON-NLS-1$
				}
			}

		}
		logger.info("END - Generate KMZ file"); //$NON-NLS-1$
	}
}
