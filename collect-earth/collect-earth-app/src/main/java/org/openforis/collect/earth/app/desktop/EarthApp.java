package org.openforis.collect.earth.app.desktop;

import java.awt.Desktop;
import java.awt.SplashScreen;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.Writer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Observable;
import java.util.Observer;

import javax.swing.JOptionPane;

import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.service.DataExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.CollectEarthWindow;
import org.openforis.collect.earth.sampler.processor.AbstractWgs84Transformer;
import org.openforis.collect.earth.sampler.processor.CircleKmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.PreprocessElevationData;
import org.openforis.collect.earth.sampler.processor.SquareKmlGenerator;
import org.openforis.collect.earth.sampler.processor.SquareWithCirclesKmlGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

public class EarthApp {

	public static final String GENERATED_FOLDER = "generated";
	public static final String FOLDER_COPIED_TO_KMZ = "earthFiles";
	private static final String KML_RESULTING_TEMP_FILE = GENERATED_FOLDER + "/plots.kml";
	private static Logger logger = LoggerFactory.getLogger(EarthApp.class);
	private static ServerController serverController;
	private static final String KMZ_FILE_PATH = GENERATED_FOLDER + "/gePlugin.kmz";
	private LocalPropertiesService localProperties = new LocalPropertiesService();

	private static final String KML_NETWORK_LINK_TEMPLATE = "resources/loadApp.fmt";
	private static final String KML_NETWORK_LINK_STARTER = GENERATED_FOLDER + "/loadApp.kml";

	private static void closeSplash() {
		try {
			logger.info("Close splash if shown");
			final SplashScreen splash = SplashScreen.getSplashScreen();
			if (splash != null) {
				splash.close();
				logger.info("Splash closed");
			}
		} catch (final IllegalStateException e) {
			logger.error("Error closing splash window", e);
		}
	}

	/**
	 * @param args
	 */
	public static void main(String[] args) {

		try {
			final EarthApp earthApp = new EarthApp();
			if (earthApp.checkFilesExist()) {
				earthApp.addElevationColumn();
				earthApp.generateKmzFile();
			}
			earthApp.initializeServer();
		} catch (final Exception e) {
			logger.error("The server could not start", e);
			System.exit(1);
		} finally {
			closeSplash();
		}
	}

	private EarthApp() throws IOException {
		localProperties.init();
	}

	public EarthApp(LocalPropertiesService localPropertiesService) throws IOException {
		this.localProperties = localPropertiesService;
	}

	private void addElevationColumn() {
		final String csvFile = localProperties.getCsvFile();
		final String epsgCode = localProperties.getCrs();

		if (!csvFile.endsWith(PreprocessElevationData.CSV_ELEV_EXTENSIOM)) {
			final PreprocessElevationData fillElevation = new PreprocessElevationData(epsgCode);
			final List<File> foundGeoTifs = getGeoTifFiles();
			if ((foundGeoTifs != null) && (foundGeoTifs.size() > 0)) {

				fillElevation.addElevationDataAndFixToWgs84(foundGeoTifs, new File(csvFile));

				// We change the name of the CSV file and CRS. The new file
				// contains the elevation data in the last column. The
				// coordinates were also changhed to WGS84
				localProperties.saveCsvFile(csvFile + PreprocessElevationData.CSV_ELEV_EXTENSIOM);
				localProperties.saveCrs(AbstractWgs84Transformer.WGS84);
			}
		}
	}

	private boolean checkFilesExist() {
		final String csvFilePath = localProperties.getCsvFile();
		final String balloonPath = localProperties.getBalloonFile();
		final String templatePath = localProperties.getTemplateFile();
		boolean filesExist = true;
		String errorMessage = "<html>Error generating the KML file for Google Earth.<br/>";
		final File csvFile = new File(csvFilePath);
		final File balloon = new File(balloonPath);
		final File template = new File(templatePath);
		if (!csvFile.exists()) {
			errorMessage += "The file containing the grid of plots as a CSV/CED is not found in the selected path :<br/><i>"
					+ csvFile.getAbsolutePath() + "</i><br/><br/>";
			filesExist = false;
		}
		if (!template.exists()) {
			errorMessage += "The file containing the Freemarker template with the KML definition is not found in the selected path :<br/><i>"
					+ template.getAbsolutePath() + "</i><br/><br/>";
			filesExist = false;
		}
		if (!balloon.exists()) {
			errorMessage += "The file containing the HTML balloon form is not found in the selected path :<br/><i>" + balloon.getAbsolutePath()
					+ "</i><br/><br/>";
			filesExist = false;
		}
		errorMessage += "Please correct the file location in the Tools->Properties menu.</html>";
		if (!filesExist) {
			showMessage(errorMessage);
		}
		return filesExist;
	}

	private void copyContentsToGeneratedFolder(String folderToInclude) throws IOException {
		final File sourceDir = new File(folderToInclude);
		final File targetDir = new File(GENERATED_FOLDER + File.separator + sourceDir.getName());
		FileUtils.copyDirectory(sourceDir, targetDir);
	}

	private void generateKml() {

		logger.info("START - Generate KML file");
		KmlGenerator generateKml = null;

		final String plotShape = localProperties.getValue(EarthProperty.SAMPLE_SHAPE);
		final String crsSystem = localProperties.getCrs();
		final int innerPointSide = Integer.parseInt(localProperties.getValue(EarthProperty.INNER_SUBPLOT_SIDE));

		if (plotShape.equals("CIRCLE")) {
			generateKml = new CircleKmlGenerator(crsSystem, localProperties.getHost(), localProperties.getPort(), innerPointSide);
		} else if (plotShape.equals("SQUARE_CIRCLE")) {
			generateKml = new SquareWithCirclesKmlGenerator(crsSystem, localProperties.getHost(), localProperties.getPort(), innerPointSide);
		} else {

			final String numberOfSamplingPlots = localProperties.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT);
			int numberOfSamplingPlotsI = 25;
			if ((numberOfSamplingPlots != null) && (numberOfSamplingPlots.trim().length() > 0)) {
				numberOfSamplingPlotsI = Integer.parseInt(numberOfSamplingPlots.trim());
			}
			generateKml = new SquareKmlGenerator(crsSystem, localProperties.getHost(), localProperties.getPort(), innerPointSide,
					numberOfSamplingPlotsI);
		}

		try {
			final String csvFile = localProperties.getCsvFile();
			String balloon = localProperties.getBalloonFile();
			final String template = localProperties.getTemplateFile();
			final String distanceBetweenSamplePoints = localProperties.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS);
			final String distancePlotBoundaries = localProperties.getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES);

			// In case the user sets up the OPEN_BALLOON_IN_FIREFOX flag to
			// true. Meaning that a small ballon opens in the placemark which in
			// its turn
			// opens a firefox browser with the real form
			final Boolean openBalloonInFirefox = Boolean.valueOf(localProperties.getValue(EarthProperty.OPEN_BALLOON_IN_BROWSER));
			if (openBalloonInFirefox) {
				balloon = localProperties.getValue(EarthProperty.ALTERNATIVE_BALLOON_FOR_BROWSER);
			}

			generateKml.generateFromCsv(csvFile, balloon, template, KML_RESULTING_TEMP_FILE, distanceBetweenSamplePoints, distancePlotBoundaries);
			updateFilesUsedChecksum();

		} catch (final IOException e) {
			logger.error("Could not generate KML file", e);
		} catch (final TemplateException e) {
			logger.error("Problems using the Freemarker template file." + e.getFTLInstructionStack(), e);
		}

		logger.info("END - Generate KML file");

	}

	public void generateKmzFile() throws IOException {

		logger.info("START - Generate KMZ file");

		if (!isKmlUpToDate()) {
			generateKml();

			try {
				final KmzGenerator kmzGenerator = new KmzGenerator();

				String balloon = localProperties.getBalloonFile();
				File balloonFile = new File(balloon);
				String folderToInclude = balloonFile.getParent() + File.separator + FOLDER_COPIED_TO_KMZ;

				kmzGenerator.generateKmzFile(KMZ_FILE_PATH, KML_RESULTING_TEMP_FILE, folderToInclude);
				logger.info("KMZ File generated : " + KMZ_FILE_PATH);

				copyContentsToGeneratedFolder(folderToInclude);

				final File kmlFile = new File(KML_RESULTING_TEMP_FILE);
				if (kmlFile.exists()) {
					final boolean deleted = kmlFile.delete();
					if (deleted) {
						logger.info("KML File deleted : " + KML_RESULTING_TEMP_FILE);
					} else {
						throw new IOException("The KML file could not be deleted at " + kmlFile.getPath());
					}
				}

			} catch (final IOException e) {
				logger.error("Error while generating KMZ file", e);
			}

		}
		logger.info("END - Generate KMZ file");
	}

	private List<File> getGeoTifFiles() {
		final String geoTiffDirectory = localProperties.getValue(EarthProperty.ELEVATION_GEOTIF_DIRECTORY);
		final File geoTifDir = new File(geoTiffDirectory);
		final File[] listFiles = geoTifDir.listFiles();
		List<File> foundGeoTifs = null;
		if ((listFiles != null) && (listFiles.length > 0)) {
			foundGeoTifs = new ArrayList<File>();
			for (final File file : listFiles) {
				if (file.getName().toLowerCase().endsWith("tif") || file.getName().toLowerCase().endsWith("tiff")) {
					foundGeoTifs.add(file);
				}
			}
		}
		return foundGeoTifs;
	}

	private String getMd5FromFile(String filePath) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(new File(filePath)));
	}

	private void initializeServer() throws Exception {

		logger.info("START - Server Initilization");
		serverController = new ServerController();
		if (serverController.isServerAlreadyRunning()) {
			closeSplash();
			showMessage("The server is already running");
			simulateClickKmz();
		} else {

			serverController.startServer(new Observer() {

				private void openMainWindow() {
					final LocalPropertiesService localPropertiesService = serverController.getContext().getBean(LocalPropertiesService.class);
					final DataExportService dataExportService = serverController.getContext().getBean(DataExportService.class);

					javax.swing.SwingUtilities.invokeLater(new Runnable() {
						@Override
						public void run() {
							final CollectEarthWindow mainEarthWindow = new CollectEarthWindow(localPropertiesService, dataExportService,
									serverController);
							mainEarthWindow.openWindow();
						}
					});

				}

				@Override
				public void update(Observable o, Object arg) {
					logger.info("END - Server Initilization");
					closeSplash();
					logger.info("Force opening of KMZ file in Google Earth");
					simulateClickKmz();
					logger.info("Open Collect Earth swing interface");
					openMainWindow();
				}

			});

		}
	}

	private boolean isKmlUpToDate() throws IOException {

		final String csvFile = localProperties.getCsvFile();
		final String balloon = localProperties.getBalloonFile();
		final String template = localProperties.getTemplateFile();

		boolean upToDate = true;
		if (!localProperties.getBalloonFileChecksum().trim().equals(getMd5FromFile(balloon))
				|| !localProperties.getTemplateFileChecksum().trim().equals(getMd5FromFile(template))
				|| !localProperties.getCsvFileChecksum().trim().equals(getMd5FromFile(csvFile))) {
			upToDate = false;
		}

		final File kmzFile = new File(KMZ_FILE_PATH);
		if (!kmzFile.exists()) {
			upToDate = false;
		}

		return upToDate;

	}

	private void openInTemporaryFile() throws IOException {

		// Process the template file using the data in the "data" Map
		final Configuration cfg = new Configuration();

		// Load template from source folder
		final Template template = cfg.getTemplate(KML_NETWORK_LINK_TEMPLATE);

		localProperties.saveGeneratedOn(System.currentTimeMillis() + "");

		final Map<String, Object> data = new HashMap<String, Object>();
		data.put("host", KmlGenerator.getHostAddress(localProperties.getHost(), localProperties.getPort()));
		data.put("kmlGeneratedOn", localProperties.getGeneratedOn());
		data.put("surveyName", localProperties.getValue(EarthProperty.SURVEY_NAME));
		data.put("plotFileName", KmlGenerator.getCsvFileName(localProperties.getValue(EarthProperty.CSV_KEY)));

		// Console output
		final FileWriter fw = new FileWriter(KML_NETWORK_LINK_STARTER);
		final Writer out = new BufferedWriter(fw);
		try {
			// Add date to avoid caching
			template.process(data, out);
			Desktop.getDesktop().open(new File(KML_NETWORK_LINK_STARTER));

		} catch (final TemplateException e) {
			logger.error("Error when producing starter KML from template", e);
		}

		out.flush();
		out.close();
		fw.close();
	}

	private void showMessage(String message) {
		JOptionPane.showMessageDialog(null, message, "Collect Earth", JOptionPane.WARNING_MESSAGE);
	}

	public void simulateClickKmz() {
		try {
			if (Desktop.isDesktopSupported()) {
				openInTemporaryFile();
			} else {
				showMessage("The KMZ file cannot be open");
			}
		} catch (final Exception e) {
			showMessage("<html>The Collect Earth file could not be open.<br/>Please make sure that Google Earth is installed.</html>");
			logger.error("The KMZ file could not be found", e);
		}
	}

	private void updateFilesUsedChecksum() throws IOException {
		final String csvFile = localProperties.getCsvFile();
		final String balloon = localProperties.getBalloonFile();
		final String template = localProperties.getTemplateFile();

		localProperties.saveBalloonFileChecksum(getMd5FromFile(balloon));
		localProperties.saveCsvFileCehcksum(getMd5FromFile(csvFile));
		localProperties.saveTemplateFileChecksum(getMd5FromFile(template));
	}

}
