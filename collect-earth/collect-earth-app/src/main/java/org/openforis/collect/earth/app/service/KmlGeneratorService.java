package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.text.MessageFormat;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.text.StringEscapeUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.BUFFER_SHAPE;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.processor.CircleKmlGenerator;
import org.openforis.collect.earth.sampler.processor.HexagonKmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
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
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.manager.process.AbstractProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.opencsv.CSVReader;
import com.opencsv.exceptions.CsvValidationException;


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

	/** What Collect Earth 1.x made for Google Earth Pro, left in the user folder by an update: deleted once. */
	static final String[] OLD_GOOGLE_EARTH_FILES = { "gePlugin.kmz", "plots.kml" }; //$NON-NLS-1$ //$NON-NLS-2$

	public static final String FREEMARKER_KML_OUTPUT_TEMPLATE_BALLOON = RESOURCES_FOLDER + File.separator
			+ "balloonForKMLExport.fmt";
	public static final String FREEMARKER_KML_OUTPUT_TEMPLATE_KML = RESOURCES_FOLDER + File.separator
			+ "kmlForKMLExport.fmt";

	public static interface PolygonTest {
		Boolean isPolygon(String[] strColumns);
	}

	/**
	 * What the project needs on this computer before its plots are shown, at start and whenever its plots are loaded
	 * again (a setting applied, data imported, another project file): the paths of its files put right
	 * (fixUserDirectory), the plot file checked, and the files of the project's own form (the balloon's
	 * earthFiles/ and webFiles/) copied to the folder the server serves them from (BalloonServlet, web_form=balloon).
	 * No KML is made: Collect Earth 2 has no Google Earth Pro, the plots map reads the plot file itself
	 * (LeafletMapController), and a project file's KML template is no longer needed, nor read.
	 *
	 * @throws KmlGenerationException when the plot file is not there, with the message to show
	 */
	public void prepareProjectFiles() throws IOException, KmlGenerationException {
		fixUserDirectory();
		prepareProjectFiles(new File(EarthConstants.GENERATED_FOLDER));
	}

	/** As {@link #prepareProjectFiles()} without the paths put right, into the given generated folder (the tests'). */
	void prepareProjectFiles(File generatedFolder) throws IOException, KmlGenerationException {
		checkPlotFile();
		copyBalloonFiles(generatedFolder);
		deleteOldGoogleEarthFiles(generatedFolder);
	}

	private void checkPlotFile() throws KmlGenerationException {
		final String csvFilePath = getLocalProperties().getCsvFile();
		if (StringUtils.isBlank(csvFilePath)) {
			throw new KmlGenerationException(Messages.getString("KmlGeneratorService.noPlotFile")); //$NON-NLS-1$
		}
		final File csvFile = new File(csvFilePath);
		if (!csvFile.exists()) {
			throw new KmlGenerationException(MessageFormat.format(Messages.getString("KmlGeneratorService.plotFileMissing"), //$NON-NLS-1$
					StringEscapeUtils.escapeHtml4(csvFile.getAbsolutePath())));
		}
	}

	/**
	 * The balloon's earthFiles/ and the optional webFiles/ (assets of the web balloon: old project files have none),
	 * from the folder of the project's balloon to the generated folder: only the files that differ, so that loading the
	 * plots again copies nothing when nothing changed. A project without a balloon has nothing to copy.
	 */
	private void copyBalloonFiles(File generatedFolder) throws IOException {
		final String balloon = getLocalProperties().getBalloonFile();
		if (StringUtils.isBlank(balloon)) {
			return;
		}
		final File projectFolder = new File(balloon).getAbsoluteFile().getParentFile();
		if (projectFolder == null) {
			return;
		}
		for (String folder : new String[] { EarthConstants.FOLDER_COPIED_TO_KMZ, EarthConstants.FOLDER_WEB_FILES }) {
			final File source = new File(projectFolder, folder);
			if (source.isDirectory()) {
				copyChanged(source, new File(generatedFolder, folder));
			}
		}
	}

	/** Copies the files of `source` into `target` that are not there yet or differ in size or date. */
	static void copyChanged(File source, File target) throws IOException {
		final File[] files = source.listFiles();
		if (files == null) {
			return;
		}
		for (File file : files) {
			final File to = new File(target, file.getName());
			if (file.isDirectory()) {
				copyChanged(file, to);
			} else if (!to.isFile() || to.length() != file.length() || to.lastModified() != file.lastModified()) {
				FileUtils.copyFile(file, to, true);
			}
		}
	}

	private void deleteOldGoogleEarthFiles(File generatedFolder) {
		for (String name : OLD_GOOGLE_EARTH_FILES) {
			final File old = new File(generatedFolder, name);
			if (old.isFile() && !old.delete()) {
				logger.debug("Could not delete {}", old.getAbsolutePath()); //$NON-NLS-1$
			}
		}
	}

	private LocalPropertiesService getLocalProperties() {
		return localPropertiesService;
	}

	/**
	 * The plots file to use instead of one that is not there: the file of the same path in the Collect Earth data folder,
	 * if it is there. Never in a cloud project, whose plots file is one its server assigned (SettingsValidator): another
	 * file found there would show plots the operator was not assigned. @return null to keep the plots file as it is
	 */
	static File plotFileElsewhere(File csvFile, String prefixUserFolder, boolean cloudProject) {
		if (cloudProject || csvFile.exists()) {
			return null;
		}
		final File otherFile = new File(prefixUserFolder + csvFile.getPath());
		return otherFile.exists() ? otherFile : null;
	}

	private void fixUserDirectory() {
		final String csvFilePath = getLocalProperties().getCsvFile();
		final String balloonPath = getLocalProperties().getBalloonFile();
		final String metadataPath = getLocalProperties().getImdFile();

		File csvFile = null;
		File balloon = null;
		File idmFile = null;
		try {
			csvFile = new File(csvFilePath);
			balloon = new File(balloonPath);
			idmFile = new File(metadataPath);

			final String prefixUserFolder = FolderFinder.getCollectEarthDataFolder() + File.separator;

			final File otherCsv = plotFileElsewhere(csvFile, prefixUserFolder, getLocalProperties().isCloudSyncEnabled());
			if (otherCsv != null) {
				getLocalProperties().setValue(EarthProperty.SAMPLE_FILE, otherCsv.getAbsolutePath());
			}

			if (!balloon.exists()) {
				final File otherFile = new File(prefixUserFolder + getLocalProperties().getBalloonFile());
				if (otherFile.exists()) {
					getLocalProperties().setValue(EarthProperty.BALLOON_TEMPLATE_KEY, otherFile.getAbsolutePath());
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

	/**
	 * Every setting {@link #getKmlGenerator()} makes the plot shape's generator with, as one text: what the plots map
	 * keeps a generator against, with its plot file, to make it again when the plot settings change.
	 */
	public String plotShapeSettings() {
		final LocalPropertiesService p = getLocalProperties();
		return String.join("\u0000", String.valueOf(p.getCrs()), String.valueOf(p.getBufferShape()), String.valueOf(p.getSampleShape()),
				String.valueOf(p.getHost()), String.valueOf(p.getPort()), String.valueOf(p.getLocalPort()),
				String.valueOf(p.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)),
				String.valueOf(p.getValue(EarthProperty.DISTANCE_BETWEEN_PLOTS)),
				String.valueOf(p.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)),
				String.valueOf(p.getValue(EarthProperty.DISTANCE_TO_BUFFERS)),
				String.valueOf(p.getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES)),
				String.valueOf(p.getValue(EarthProperty.INNER_SUBPLOT_SIDE)),
				String.valueOf(p.getValue(EarthProperty.LARGE_CENTRAL_PLOT_SIDE)));
	}

	public KmlGenerator getKmlGenerator() throws KmlGenerationException, CsvValidationException {
		KmlGenerator generateKml = null;

		final String crsSystem = getLocalProperties().getCrs();
		final Integer innerPointSide = parseInt(getLocalProperties().getValue(EarthProperty.INNER_SUBPLOT_SIDE));
		final Integer largeCentralPlotSide = parseInt(
				getLocalProperties().getValue(EarthProperty.LARGE_CENTRAL_PLOT_SIDE));
		final String distanceToBuffers = getLocalProperties().getValue(EarthProperty.DISTANCE_TO_BUFFERS);
		final BUFFER_SHAPE bufferShape = getLocalProperties().getBufferShape();
		SAMPLE_SHAPE plotShape = getLocalProperties().getSampleShape();
		final String hostAddress = ServerController.getHostAddress(getLocalProperties().getHost(),
				getLocalProperties().getPort());

		final float distanceBetweenSamplePoints;
		final float distanceToPlotBoundaries;
		// The plot options panel saves the rows a plot shape does not use (e.g. the distance between points of a
		// square plot with a single point, or the margin of a round plot) as empty properties
		String dBSP = getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS);
		try {
			distanceBetweenSamplePoints = StringUtils.isBlank(dBSP) ? 0 : Float.parseFloat(dBSP);
		} catch (Exception e) {
			logger.error("Error parsing distance between sample points , wrong value : " + dBSP, e);
			notANumber("KmlGeneratorService.distanceBetweenSamplePoints", dBSP);
			return null;
		}

		String dToPlotB = getLocalProperties().getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES);
		try {
			distanceToPlotBoundaries = StringUtils.isBlank(dToPlotB) ? 0 : Float.parseFloat(dToPlotB);
		} catch (Exception e) {
			logger.error("Error parsing distance between plots , wrong value : " + dToPlotB, e);
			notANumber("KmlGeneratorService.distanceToPlotBoundaries", dToPlotB);
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
						distanceBetweenSamplePoints, distanceToBuffers, bufferShape);
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
					notANumber("KmlGeneratorService.distanceBetweenPlots", dBP);
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
					notANumber("KmlGeneratorService.distanceBetweenPlots", dBP);
					return null;
				}

				generateKml = new NfiFourCirclesGenerator(crsSystem, hostAddress, localPort, innerPointSide,
						distanceBetweenSamplePoints, distanceBetweenPlots);
			} else if (plotShape.equals(SAMPLE_SHAPE.HEXAGON)) {
				generateKml = new HexagonKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide, numberOfPoints,
						distanceBetweenSamplePoints, distanceToBuffers, bufferShape);
			} else if (plotShape.equals(SAMPLE_SHAPE.SQUARE_CIRCLE)) {
				generateKml = new SquareWithCirclesKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide,
						numberOfPoints, distanceBetweenSamplePoints, distanceToPlotBoundaries, distanceToBuffers, bufferShape);
			} else if (plotShape.equals(SAMPLE_SHAPE.KML_POLYGON)) {
				generateKml = new PolygonKmlGenerator(crsSystem, hostAddress, localPort);
			} else if (plotShape.equals(SAMPLE_SHAPE.GEOJSON_POLYGON)) {
				generateKml = new PolygonGeojsonGenerator(crsSystem, hostAddress, localPort);
			} else if (plotShape.equals(SAMPLE_SHAPE.WKT_POLYGON)) {
				generateKml = new PolygonWktGenerator(crsSystem, hostAddress, localPort);
			} else {
				generateKml = new SquareKmlGenerator(crsSystem, hostAddress, localPort, innerPointSide, numberOfPoints,
						distanceBetweenSamplePoints, distanceToPlotBoundaries, largeCentralPlotSide, distanceToBuffers, bufferShape);
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

	/**
	 * Runs the export of the records to the CSV the KML is made from: with its progress, for the export job of the
	 * pages (ExportService), or simply to the end.
	 */
	@FunctionalInterface
	public interface CsvExportRunner {
		/** @return false when the export was cancelled: no KML is generated then */
		boolean run(AbstractProcess<Void, DataExportStatus> csvExport) throws Exception;
	}

	/**
	 * A distance of earth.properties that is not a number, which only a file edited by hand can have now that the
	 * settings page checks them: said as a notice of the pages.
	 */
	private static void notANumber(String settingKey, String value) {
		EarthApp.notify(Notice.WARNING, MessageFormat.format(Messages.getString("KmlGeneratorService.notANumber"), //$NON-NLS-1$
				Messages.getString(settingKey), StringEscapeUtils.escapeHtml4(String.valueOf(value))));
	}

	public void exportToKml(File exportToFile) throws Exception {
		exportToKml(exportToFile, csvExport -> {
			csvExport.startProcessing();
			return true;
		});
	}

	/** The records exported to a KML: first to a CSV, run by the runner given, then the KML generated from it. */
	public void exportToKml(File exportToFile, CsvExportRunner csvExportRunner) throws Exception {

		KmlGenerator kmlGenerator = null;
		kmlGenerator = getKmlGenerator();

		if (kmlGenerator == null) {
			throw new KmlGenerationException("Error while generating KML");
		}

		File csvTempFile = null;
		File balloonFile = null;
		try {
			csvTempFile = File.createTempFile("surveyData",  ".csv");
			// The CSV with the data collected
			if (!csvExportRunner.run(dataImportExportService.exportSurveyAsCsv(csvTempFile, false))) {
				return;
			}

			try (BufferedReader brCsvReader = new BufferedReader(new FileReader(csvTempFile))) {
				String headerLine = brCsvReader.readLine();
				if (headerLine == null) {
					// An export of a survey with no data used to throw a NullPointerException on the line below
					throw new KmlGenerationException("There is no data to export : the CSV generated from the survey is empty");
				}
				headerLine = headerLine.replaceAll("\"", ""); // remove the quotes that are used in the CSV
				String[] headers = headerLine.split(",");
				balloonFile = generateKmlExportBallonFile(headers); // get an HTML balloon template that matches the survey

				// Using all of the files that compose the final KML it is generated and stores
				// in KML_RESULTING_TEMP_FILE
				kmlGenerator.generateKmlFile(exportToFile.getAbsolutePath(), csvTempFile.getAbsolutePath(), balloonFile.getAbsolutePath(), FREEMARKER_KML_OUTPUT_TEMPLATE_KML,
						earthSurveyService.getCollectSurvey(), true);
			}
		} finally {
			// Clean up temp files
			if (csvTempFile != null && csvTempFile.exists() && !csvTempFile.delete()) {
				logger.warn("Failed to delete temp CSV file: {}", csvTempFile.getAbsolutePath());
			}
			if (balloonFile != null && balloonFile.exists() && !balloonFile.delete()) {
				logger.warn("Failed to delete temp balloon file: {}", balloonFile.getAbsolutePath());
			}
		}
	}

	private File generateKmlExportBallonFile(String[] attributeNames) throws KmlGenerationException, IOException {
		// Build the data-model
		final Map<String, Object> data = new HashMap<>();

		data.put("attributes", attributeNames);
		File destniationFileTemp = null;
		try {

			destniationFileTemp = File.createTempFile("TempBalloonForKML", ".html");

			// Process the template file using the data in the "data" Map
			final File templateFile = new File(FREEMARKER_KML_OUTPUT_TEMPLATE_BALLOON);

			FreemarkerTemplateUtils.applyTemplate(templateFile, destniationFileTemp, data);

		} catch (Exception e) {
			throw new KmlGenerationException("Error generating the KML file to open in Google Earth "
					+ FREEMARKER_KML_OUTPUT_TEMPLATE_BALLOON + " with data " + Arrays.toString(data.values().toArray()), e);
		}
		return destniationFileTemp;

	}
}
