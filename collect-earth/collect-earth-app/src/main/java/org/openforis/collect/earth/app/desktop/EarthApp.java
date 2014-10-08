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
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.service.FolderFinder;
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

	private static final String KML_RESULTING_TEMP_FILE = EarthConstants.GENERATED_FOLDER + File.separator + "plots.kml";
	private static Logger logger;
	private static ServerController serverController;
	private static final String KMZ_FILE_PATH = EarthConstants.GENERATED_FOLDER + File.separator + "gePlugin.kmz";
	private static EarthApp earthApp;
	private LocalPropertiesService nonManagedPropertiesService;
	
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

	public static KmlGenerator getKmlGenerator() {
		KmlGenerator generateKml;
		final String crsSystem = earthApp.getLocalProperties().getCrs();
		final Integer innerPointSide = Integer.parseInt(earthApp.getLocalProperties().getValue(EarthProperty.INNER_SUBPLOT_SIDE));
		final SAMPLE_SHAPE plotShape = earthApp.getLocalProperties().getSampleShape();
		if (plotShape.equals(SAMPLE_SHAPE.CIRCLE)) {
			generateKml = new CircleKmlGenerator(crsSystem, earthApp.getLocalProperties().getHost(), earthApp.getLocalProperties().getPort(), earthApp.getLocalProperties().getLocalPort(),
					innerPointSide, Float.parseFloat(earthApp.getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)));
		} else if (plotShape.equals(SAMPLE_SHAPE.OCTAGON)) {
			generateKml = new OctagonKmlGenerator(crsSystem, earthApp.getLocalProperties().getHost(), earthApp.getLocalProperties().getPort(), earthApp.getLocalProperties().getLocalPort(),
					innerPointSide, Float.parseFloat(earthApp.getLocalProperties().getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)));
		} else if (plotShape.equals(SAMPLE_SHAPE.SQUARE_CIRCLE)) {
			generateKml = new SquareWithCirclesKmlGenerator(crsSystem, earthApp.getLocalProperties().getHost(), earthApp.getLocalProperties().getPort(),
					earthApp.getLocalProperties().getLocalPort(), innerPointSide);
		} else {

			final String numberOfSamplingPlots = earthApp.getLocalProperties().getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT);
			int numberOfSamplingPlotsI = 25;
			if ((numberOfSamplingPlots != null) && (numberOfSamplingPlots.trim().length() > 0)) {
				numberOfSamplingPlotsI = Integer.parseInt(numberOfSamplingPlots.trim());
			}
			generateKml = new SquareKmlGenerator(crsSystem, earthApp.getLocalProperties().getHost(), earthApp.getLocalProperties().getPort(), earthApp.getLocalProperties().getLocalPort(),
					innerPointSide, numberOfSamplingPlotsI);
		}
		return generateKml;
	}

	/**
	 * Start the application, opening Google Earth and starting the Jetty server.
	 * 
	 * @param args
	 *            No arguments are used by this method.
	 */
	public static void main(String[] args) {

		try {
			// System property used in the log4j.properties configuration
			System.setProperty("collectEarth.userFolder", FolderFinder.getLocalFolder());
			logger = LoggerFactory.getLogger(EarthApp.class);

			earthApp = new EarthApp();
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

	private CollectEarthWindow mainEarthWindow;
		private static final String KML_NETWORK_LINK_TEMPLATE = "resources/loadApp.fmt";

	private static final String KML_NETWORK_LINK_STARTER = EarthConstants.GENERATED_FOLDER + "/loadApp.kml";

	public static void restart() {
		try {

			serverController.stopServer();

			final Observer observeInitializationAfterRestart = new Observer() {

				@Override
				public void update(Observable o, Object arg) {
					try {
						if (arg.equals(ServerController.SERVER_STARTED_EVENT)) {
							earthApp.generatePlacemarksKmzFile();
							earthApp.simulateClickKmz();
							earthApp.mainEarthWindow.setServerController(serverController);
							earthApp.mainEarthWindow.openWindow();
						}
					} catch (final IOException e) {
						logger.error("Error generating KMZ file", e);
					} catch (final Exception e) {
						logger.error("Error starting server", e);
						e.printStackTrace();
					}

				}

			};

			earthApp.serverStartAndOpenGe(observeInitializationAfterRestart);

		} catch (final Exception e) {
			logger.error("Error while stopping server", e);
		}
	}

	private EarthApp() throws IOException {
		getLocalProperties().init();
	}

	private void addElevationColumn() {
		final String csvFile = getLocalProperties().getCsvFile();
		final String epsgCode = getLocalProperties().getCrs();

		if (!csvFile.endsWith(PreprocessElevationData.CSV_ELEV_EXTENSION)) {
			final PreprocessElevationData fillElevation = new PreprocessElevationData(epsgCode);
			final List<File> foundGeoTifs = getGeoTifFiles();
			if ((foundGeoTifs != null) && (foundGeoTifs.size() > 0)) {

				fillElevation.addElevationDataAndFixToWgs84(foundGeoTifs, new File(csvFile));

				// We change the name of the CSV file and CRS. The new file
				// contains the elevation data in the last column. The
				// coordinates were also changed to WGS84
				getLocalProperties().saveCsvFile(csvFile + PreprocessElevationData.CSV_ELEV_EXTENSION);
				getLocalProperties().saveCrs(AbstractCoordinateCalculation.WGS84);
			}
		}
	}

	private boolean checkFilesExist() {

		fixUserDirectory();

		final String csvFilePath = getLocalProperties().getCsvFile();
		final String balloonPath = getLocalProperties().getBalloonFile();
		final String templatePath = getLocalProperties().getTemplateFile();
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
		if (csvFile != null && !csvFile.exists()) {
			errorMessage += "The file containing the grid of plots as a CSV/CED is not found in the selected path :<br/><i>"
					+ csvFile.getAbsolutePath() + "</i><br/><br/>";
			filesExist = false;
		} else if (csvFile == null) {
			errorMessage += "No CSV/CED file has been set-up :<br/><br/>";
			filesExist = false;
		}

		if (template != null && !template.exists()) {
			errorMessage += "The file containing the Freemarker template with the KML definition is not found in the selected path :<br/><i>"
					+ template.getAbsolutePath() + "</i><br/><br/>";
			filesExist = false;
		} else if (template == null) {
			errorMessage += "No KML definition file has been set-up :<br/><br/>";
			filesExist = false;
		}

		if (balloon != null && !balloon.exists()) {
			errorMessage += "The file containing the HTML balloon form is not found in the selected path :<br/><i>" + balloon.getAbsolutePath()
					+ "</i><br/><br/>";
			filesExist = false;
		} else if (balloon == null) {
			errorMessage += "No HTML balloon file has been set-up :<br/><br/>";
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
			logger.error("One of the definition files is not defined", e);
		}

	}

	private void generateKml() {

		logger.info("START - Generate KML file");
		KmlGenerator generateKml = null;
		generateKml = getKmlGenerator();

		try {
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

		} catch (final IOException e) {
			logger.error("Could not generate KML file", e);
		} catch (final TemplateException e) {
			logger.error("Problems using the Freemarker template file." + e.getFTLInstructionStack(), e);
		}

		logger.info("END - Generate KML file");

	}

	private void generateLoaderKmlFile() throws IOException {

		getLocalProperties().saveGeneratedOn(System.currentTimeMillis() + "");

		final Map<String, Object> data = new HashMap<String, Object>();
		data.put("host", KmlGenerator.getHostAddress(getLocalProperties().getHost(), getLocalProperties().getLocalPort()));
		data.put("kmlGeneratedOn", getLocalProperties().getGeneratedOn());
		data.put("surveyName", getLocalProperties().getValue(EarthProperty.SURVEY_NAME));
		data.put("plotFileName", KmlGenerator.getCsvFileName(getLocalProperties().getValue(EarthProperty.CSV_KEY)));

		FreemarkerTemplateUtils.applyTemplate(new File(KML_NETWORK_LINK_TEMPLATE), new File(KML_NETWORK_LINK_STARTER), data);
	}

	private void generatePlacemarksKmzFile() throws IOException {

		logger.info("START - Generate KMZ file");

		if (!isKmlUpToDate()) {
			generateKml();

			try {
				final KmzGenerator kmzGenerator = new KmzGenerator();

				final String balloon = getLocalProperties().getBalloonFile();
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
		final String geoTiffDirectory = getLocalProperties().getValue(EarthProperty.ELEVATION_GEOTIF_DIRECTORY);
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

	private LocalPropertiesService getLocalProperties() {
		if( serverController == null || serverController.getContext()== null){
			if( nonManagedPropertiesService == null ){
				nonManagedPropertiesService = new LocalPropertiesService();
				try {
					nonManagedPropertiesService.init();
				} catch (IOException e) {
					// TODO Auto-generated catch block
					e.printStackTrace();
				}
			}
			return nonManagedPropertiesService; 
		}else{
			return serverController.getContext().getBean( LocalPropertiesService.class );
		}
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
			final Observer observeInitialization = new Observer() {

				@Override
				public void update(Observable o, Object arg) {
					if (arg.equals(ServerController.SERVER_STARTED_WITH_EXCEPTION_EVENT )) {
						serverController = null;
					}
						
					
					try {
													
						simulateClickKmz();
						
						closeSplash();

						openMainWindow();
					} catch (Exception e) {
						logger.error("Error generating KML file", e);
					}
						
				}
			};
			serverStartAndOpenGe(observeInitialization);
		}
	}

	private boolean isKmlUpToDate() throws IOException {

		final String csvFile = getLocalProperties().getCsvFile();
		final String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();

		boolean upToDate = true;
		if (!getLocalProperties().getBalloonFileChecksum().trim().equals(getMd5FromFile(balloon))
				|| !getLocalProperties().getTemplateFileChecksum().trim().equals(getMd5FromFile(template))
				|| !getLocalProperties().getCsvFileChecksum().trim().equals(getMd5FromFile(csvFile))) {
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
		Messages.setLocale(getLocalProperties().getUiLanguage().getLocale());

		javax.swing.SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				try {
					mainEarthWindow = new CollectEarthWindow();
					mainEarthWindow.setServerController(serverController);
					mainEarthWindow.openWindow();
				} catch (final Exception e) {
					logger.error("Cannot start Earth App", e);
					System.exit(0);
				}
			}
		});

	}

	private void serverStartAndOpenGe(Observer observeInitialization) throws IOException, Exception {
		
		serverController.deleteObservers();
		serverController.startServer(observeInitialization);
		
		
		
	}

	private void showMessage(String message) {
		JOptionPane.showMessageDialog(null, message, "Collect Earth", JOptionPane.WARNING_MESSAGE);
	}

	private void simulateClickKmz() {
		try {
			generateLoaderKmlFile();
			openGoogleEarth();

		} catch (final Exception e) {
			showMessage("<html>The Collect Earth file could not be open.<br/>Please make sure that Google Earth is installed.</html>");
			logger.error("The KMZ file could not be found", e);
		}
	}

	private void updateFilesUsedChecksum() throws IOException {
		final String csvFile = getLocalProperties().getCsvFile();
		final String balloon = getLocalProperties().getBalloonFile();
		final String template = getLocalProperties().getTemplateFile();

		getLocalProperties().saveBalloonFileChecksum(getMd5FromFile(balloon));
		getLocalProperties().saveCsvFileCehcksum(getMd5FromFile(csvFile));
		getLocalProperties().saveTemplateFileChecksum(getMd5FromFile(template));
	}

}
