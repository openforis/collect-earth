package org.openforis.collect.earth.app.desktop;

import java.awt.Desktop;
import java.awt.SplashScreen;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Observable;
import java.util.Observer;

import javax.swing.JOptionPane;

import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.CollectEarthWindow;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.sampler.processor.AbstractCoordinateCalculation;
import org.openforis.collect.earth.sampler.processor.CircleKmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.OctagonKmlGenerator;
import org.openforis.collect.earth.sampler.processor.PreprocessElevationData;
import org.openforis.collect.earth.sampler.processor.SquareKmlGenerator;
import org.openforis.collect.earth.sampler.processor.SquareWithCirclesKmlGenerator;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import freemarker.template.TemplateException;

/**
 * Contains the main class that starts Collect Earth and opens Google Earth.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
public class EarthApp {

	private static final String KML_RESULTING_TEMP_FILE = EarthConstants.GENERATED_FOLDER + "/plots.kml";
	private static Logger logger = LoggerFactory.getLogger(EarthApp.class);
	private static ServerController serverController;
	private static final String KMZ_FILE_PATH = EarthConstants.GENERATED_FOLDER + "/gePlugin.kmz";

	public static KmlGenerator getKmlGenerator(LocalPropertiesService localProperties) {
		KmlGenerator generateKml;
		final String crsSystem = localProperties.getCrs();
		final Integer innerPointSide = Integer.parseInt(localProperties.getValue(EarthProperty.INNER_SUBPLOT_SIDE));
		final SAMPLE_SHAPE plotShape = localProperties.getSampleShape();
		if (plotShape.equals(SAMPLE_SHAPE.CIRCLE)) {
			generateKml = new CircleKmlGenerator(crsSystem, localProperties.getHost(), localProperties.getPort(), localProperties.getLocalPort(),
					innerPointSide, Float.parseFloat(localProperties.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)));
		} else if (plotShape.equals(SAMPLE_SHAPE.OCTAGON)) {
			generateKml = new OctagonKmlGenerator(crsSystem, localProperties.getHost(), localProperties.getPort(), localProperties.getLocalPort(),
					innerPointSide, Float.parseFloat(localProperties.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)));
		} else if (plotShape.equals(SAMPLE_SHAPE.SQUARE_CIRCLE)) {
			generateKml = new SquareWithCirclesKmlGenerator(crsSystem, localProperties.getHost(), localProperties.getPort(),
					localProperties.getLocalPort(), innerPointSide);
		} else {

			final String numberOfSamplingPlots = localProperties.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT);
			int numberOfSamplingPlotsI = 25;
			if ((numberOfSamplingPlots != null) && (numberOfSamplingPlots.trim().length() > 0)) {
				numberOfSamplingPlotsI = Integer.parseInt(numberOfSamplingPlots.trim());
			}
			generateKml = new SquareKmlGenerator(crsSystem, localProperties.getHost(), localProperties.getPort(), localProperties.getLocalPort(),
					innerPointSide, numberOfSamplingPlotsI);
		}
		return generateKml;
	}

	private LocalPropertiesService localProperties = new LocalPropertiesService();
	private static final String KML_NETWORK_LINK_TEMPLATE = "resources/loadApp.fmt";

	private static final String KML_NETWORK_LINK_STARTER = EarthConstants.GENERATED_FOLDER + "/loadApp.kml";

	private static void closeSplash() {
		try {
			final SplashScreen splash = SplashScreen.getSplashScreen();
			if (splash != null) {
				splash.close();
			}
		} catch (final IllegalStateException e) {
			logger.error("Error closing the splash window", e);
		}
	}

	/**
	 * Start the application, opening Google Earth and starting the Jetty server.
	 * 
	 * @param args
	 *            No arguments are used by this method.
	 */
	public static void main(String[] args) {

		try {
			final EarthApp earthApp = new EarthApp();
			if (earthApp.checkFilesExist()) {
				earthApp.addElevationColumn();
				earthApp.generatePlacemarksKmzFile();
			}

			earthApp.initializeServer();

		} catch (final Exception e) {
			// The logger factory has not been initialized, this will not work, just output to console
			// logger.error("The server could not start", e);
			e.printStackTrace();
			System.exit(1);
		} finally {
			closeSplash();
		}
	}

	private EarthApp() throws IOException {
		localProperties.init();
	}

	public EarthApp(LocalPropertiesService localPropertiesService) throws IOException {
		localProperties = localPropertiesService;
	}

	private void addElevationColumn() {
		final String csvFile = localProperties.getCsvFile();
		final String epsgCode = localProperties.getCrs();

		if (!csvFile.endsWith(PreprocessElevationData.CSV_ELEV_EXTENSION)) {
			final PreprocessElevationData fillElevation = new PreprocessElevationData(epsgCode);
			final List<File> foundGeoTifs = getGeoTifFiles();
			if ((foundGeoTifs != null) && (foundGeoTifs.size() > 0)) {

				fillElevation.addElevationDataAndFixToWgs84(foundGeoTifs, new File(csvFile));

				// We change the name of the CSV file and CRS. The new file
				// contains the elevation data in the last column. The
				// coordinates were also changed to WGS84
				localProperties.saveCsvFile(csvFile + PreprocessElevationData.CSV_ELEV_EXTENSION);
				localProperties.saveCrs(AbstractCoordinateCalculation.WGS84);
			}
		}
	}

	private boolean checkFilesExist() {
		final String csvFilePath = localProperties.getCsvFile();
		final String balloonPath = localProperties.getBalloonFile();
		final String templatePath = localProperties.getTemplateFile();
		boolean filesExist = true;
		String errorMessage = "<html>Error generating the KML file for Google Earth.<br/>";
		File csvFile = null;
		File balloon = null;
		File template = null;
		try {
			csvFile = new File(csvFilePath);
			balloon = new File(balloonPath);
			template = new File(templatePath);
		} catch (final Exception e) {
			logger.error("One of the definition files is not defined", e);
		}
		if (csvFile == null || !csvFile.exists()) {
			errorMessage += "The file containing the grid of plots as a CSV/CED is not found in the selected path :<br/><i>"
					+ csvFile.getAbsolutePath() + "</i><br/><br/>";
			filesExist = false;
		}
		if (template == null || !template.exists()) {
			errorMessage += "The file containing the Freemarker template with the KML definition is not found in the selected path :<br/><i>"
					+ template.getAbsolutePath() + "</i><br/><br/>";
			filesExist = false;
		}
		if (balloon == null || !balloon.exists()) {
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
		final File targetDir = new File(EarthConstants.GENERATED_FOLDER + File.separator + sourceDir.getName());
		FileUtils.copyDirectory(sourceDir, targetDir);
	}

	private void generateKml() {

		logger.info("START - Generate KML file");
		KmlGenerator generateKml = null;
		generateKml = EarthApp.getKmlGenerator(localProperties);

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

	private void generateLoaderKmlFile() throws IOException {

		localProperties.saveGeneratedOn(System.currentTimeMillis() + "");

		final Map<String, Object> data = new HashMap<String, Object>();
		data.put("host", KmlGenerator.getHostAddress(localProperties.getHost(), localProperties.getLocalPort()));
		data.put("kmlGeneratedOn", localProperties.getGeneratedOn());
		data.put("surveyName", localProperties.getValue(EarthProperty.SURVEY_NAME));
		data.put("plotFileName", KmlGenerator.getCsvFileName(localProperties.getValue(EarthProperty.CSV_KEY)));

		FreemarkerTemplateUtils.applyTemplate(new File(KML_NETWORK_LINK_TEMPLATE), new File(KML_NETWORK_LINK_STARTER), data);
	}

	private void generatePlacemarksKmzFile() throws IOException {

		logger.info("START - Generate KMZ file");

		if (!isKmlUpToDate()) {
			generateKml();

			try {
				final KmzGenerator kmzGenerator = new KmzGenerator();

				final String balloon = localProperties.getBalloonFile();
				final File balloonFile = new File(balloon);
				final String folderToInclude = balloonFile.getParent() + File.separator + EarthConstants.FOLDER_COPIED_TO_KMZ;

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
			Observer observeInitialization = new Observer() {

				@Override
				public void update(Observable o, Object arg) {
					closeSplash();
					
					simulateClickKmz();
					 
					openMainWindow();
				}
			};
			serverStartAndOpenGe(observeInitialization);
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

	private void openGoogleEarth() throws IOException {
		if (Desktop.isDesktopSupported()) {
			Desktop.getDesktop().open(new File(KML_NETWORK_LINK_STARTER));
		} else {
			showMessage("The KMZ file cannot be open");
		}
	}

	private void openMainWindow() {
		// Initialize the translations
		Messages.setLocale(localProperties.getUiLanguage().getLocale());

		javax.swing.SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				try {
					final CollectEarthWindow mainEarthWindow = new CollectEarthWindow(serverController);
					mainEarthWindow.openWindow();
				} catch (final Exception e) {
					logger.error("Cannot start Earth App", e);
					System.exit(0);
				}
			}
		});

	}

	public void restart() {
		try {
			serverController.stopServer();

			Observer observeInitialization = new Observer() {

				@Override
				public void update(Observable o, Object arg) {
					try {
						generatePlacemarksKmzFile();
						simulateClickKmz();
					} catch (IOException e) {
						logger.error("Error generating KMZ file", e);
					}
				}

			};
			
			serverStartAndOpenGe(observeInitialization);

		} catch (final Exception e) {
			logger.error("Error while stopping server", e);
		}
	}

	private void serverStartAndOpenGe( Observer observeInitialization ) throws IOException, Exception {
		generateLoaderKmlFile();
		
		final boolean highDemandServer = localProperties.getOperationMode().equals(OperationMode.SERVER_MODE);
		
		serverController.deleteObservers();
		serverController.startServer(highDemandServer, observeInitialization);
	}

	private void showMessage(String message) {
		JOptionPane.showMessageDialog(null, message, "Collect Earth", JOptionPane.WARNING_MESSAGE);
	}

	private void simulateClickKmz() {
		try {
			
			openGoogleEarth();
			
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
