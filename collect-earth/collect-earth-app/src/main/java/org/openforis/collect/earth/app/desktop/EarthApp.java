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
import org.openforis.collect.earth.app.service.DataExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
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

	private static final String SURVEY_NAME = "survey_name";
	private static final String KML_RESULTING_TEMP_FILE = "generated/plots.kml";
	private final static Logger LOGGER = LoggerFactory.getLogger(EarthApp.class);
	private static ServerController serverController;
	private static final String KMZ_FILE_PATH = "generated/gePlugin.kmz";
	private final LocalPropertiesService nonSpringManagedProperties = new LocalPropertiesService();

	private static final String KML_NETWORK_LINK_TEMPLATE = "resources/loadApp.fmt";
	private static final String KML_NETWORK_LINK_STARTER = "generated/loadApp.kml";

	private static void closeSplash() {
		try {
			LOGGER.info("Close splash if shown");
			SplashScreen splash = SplashScreen.getSplashScreen();
			if (splash != null) {
				splash.close();
				LOGGER.info("Splash closed");
			}
		} catch (IllegalStateException e) {
			LOGGER.error("Error closing splash window", e);
		}
	}

	/**
	 * @param args
	 */
	public static void main(String[] args) {

		try {
			EarthApp earthApp = new EarthApp();
			earthApp.addElevationColumn();
			earthApp.generateKmzFile();
			earthApp.initializeServer();
		} catch (Exception e) {
			LOGGER.error("The server could not start", e);
			System.exit(1);
		} finally {
			closeSplash();
		}
	}

	private EarthApp() throws IOException {
		nonSpringManagedProperties.init();
	}

	private void addElevationColumn() {
		String csvFile = nonSpringManagedProperties.getCsvFile();
		String epsgCode = nonSpringManagedProperties.getCrs();

		if (!csvFile.endsWith(PreprocessElevationData.CSV_ELEV_EXTENSIOM)) {
			PreprocessElevationData fillElevation = new PreprocessElevationData(epsgCode);
			List<File> foundGeoTifs = getGeoTifFiles();
			if( foundGeoTifs!=null && foundGeoTifs.size() > 0 ){

				fillElevation.addElevationDataAndFixToWgs84(foundGeoTifs, new File(csvFile));

				// We change the name of the CSV file and CRS. The new file contains the elevation data in the last column. The coordinates were also changhed to WGS84
				nonSpringManagedProperties.saveCsvFile(csvFile + PreprocessElevationData.CSV_ELEV_EXTENSIOM);
				nonSpringManagedProperties.saveCrs(AbstractWgs84Transformer.WGS84);
			}
		}
	}

	private List<File> getGeoTifFiles() {
		String geoTiffDirectory = nonSpringManagedProperties.getValue(LocalPropertiesService.ELEVATION_GEOTIF_DIRECTORY);
		File geoTifDir = new File(geoTiffDirectory);
		File[] listFiles = geoTifDir.listFiles();
		List<File> foundGeoTifs = null;
		if (listFiles != null && listFiles.length > 0) {
			foundGeoTifs = new ArrayList<File>();
			for (File file : listFiles) {
				if (file.getName().toLowerCase().endsWith("tif") || file.getName().toLowerCase().endsWith("tiff")) {
					foundGeoTifs.add(file);
				}
			}
		}
		return foundGeoTifs;
	}

	private void generateKml() {

		LOGGER.info("START - Generate KML file");
		// KmlGenerator generateKml = new OnePointKmlGenerator();
		KmlGenerator generateKml = null;

		String plotShape = nonSpringManagedProperties.getValue( LocalPropertiesService.SAMPLE_SHAPE);
		String crsSystem = nonSpringManagedProperties.getCrs();
		int innerPointSide = Integer.parseInt(nonSpringManagedProperties.getValue( LocalPropertiesService.INNER_SUBPLOT_SIDE ));

		if (plotShape.equals("CIRCLE")) {
			generateKml = new CircleKmlGenerator(crsSystem, nonSpringManagedProperties.getHost(),
					nonSpringManagedProperties.getPort(), innerPointSide);
		} else if (plotShape.equals("SQUARE_CIRCLE")) {
			generateKml = new SquareWithCirclesKmlGenerator(crsSystem, nonSpringManagedProperties.getHost(),
					nonSpringManagedProperties.getPort(), innerPointSide);
		}else{
			generateKml = new SquareKmlGenerator(crsSystem, nonSpringManagedProperties.getHost(),
					nonSpringManagedProperties.getPort(), innerPointSide);
		}

		try {
			String csvFile = nonSpringManagedProperties.getCsvFile();
			String balloon = nonSpringManagedProperties.getBalloonFile();
			String template = nonSpringManagedProperties.getTemplateFile();
			String distanceBetweenSamplePoints = nonSpringManagedProperties.getValue(LocalPropertiesService.DISTANCE_BETWEEN_SAMPLE_POINTS );
			String distancePlotBoundaries = nonSpringManagedProperties.getValue(LocalPropertiesService.DISTANCE_TO_PLOT_BOUNDARIES);

			// In case the user sets up the OPEN_BALLOON_IN_FIREFOX flag to true. Meaning that a small ballon opens in the placemark which in its turn 
			// opens a firefox browser with the real form
			Boolean openBalloonInFirefox = new Boolean(
					nonSpringManagedProperties.getValue(LocalPropertiesService.OPEN_BALLOON_IN_FIREFOX));
			if (openBalloonInFirefox) {
				balloon = nonSpringManagedProperties.getValue(LocalPropertiesService.SIMPLE_BALLOON_FOR_FIREFOX);
			}
			
			
			generateKml.generateFromCsv(csvFile, balloon, template, KML_RESULTING_TEMP_FILE, distanceBetweenSamplePoints,
					distancePlotBoundaries);
			updateFilesUsedChecksum();

		} catch (IOException e) {
			LOGGER.error("Could not generate KML file", e);
		} catch (TemplateException e) {
			LOGGER.error("Problems using the Freemarker template file." + e.getFTLInstructionStack(), e);
		}

		LOGGER.info("END - Generate KML file");

	}

	private void updateFilesUsedChecksum() throws IOException {
		String csvFile = nonSpringManagedProperties.getCsvFile();
		String balloon = nonSpringManagedProperties.getBalloonFile();
		String template = nonSpringManagedProperties.getTemplateFile();

		nonSpringManagedProperties.saveBalloonFileChecksum(getMd5FromFile(balloon));
		nonSpringManagedProperties.saveCsvFileCehcksum(getMd5FromFile(csvFile));
		nonSpringManagedProperties.saveTemplateFileChecksum(getMd5FromFile(template));
	}

	private String getMd5FromFile(String csvFile) throws IOException {
		return DigestUtils.md5Hex(new FileInputStream(new File(csvFile)));
	}

	private void generateKmzFile() throws IOException {

		LOGGER.info("START - Generate KMZ file");

		if (!isKmlUpToDate()) {
			generateKml();

			try {
				KmzGenerator kmzGenerator = new KmzGenerator();
				kmzGenerator.generateKmzFile(KMZ_FILE_PATH, KML_RESULTING_TEMP_FILE,
						nonSpringManagedProperties.getValue(LocalPropertiesService.FILES_TO_INCLUDE_IN_KMZ));
				LOGGER.info("KMZ File generated : " + KMZ_FILE_PATH);

				File kmlFile = new File(KML_RESULTING_TEMP_FILE);
				if (kmlFile.exists()) {
					boolean deleted = kmlFile.delete();
					if (deleted) {
						LOGGER.info("KML File deleted : " + KML_RESULTING_TEMP_FILE);
					} else {
						throw new IOException("The KML file could not be deleted at " + kmlFile.getPath());
					}
				}

			} catch (IOException e) {
				LOGGER.error("Error while generating KMZ file", e);
			}

		}
		LOGGER.info("END - Generate KMZ file");
	}

	private boolean isKmlUpToDate() throws IOException {

		String csvFile = nonSpringManagedProperties.getCsvFile();
		String balloon = nonSpringManagedProperties.getBalloonFile();
		String template = nonSpringManagedProperties.getTemplateFile();

		boolean upToDate = true;
		if (!nonSpringManagedProperties.getBalloonFileChecksum().trim().equals(getMd5FromFile(balloon))
				|| !nonSpringManagedProperties.getTemplateFileChecksum().trim().equals(getMd5FromFile(template))
				|| !nonSpringManagedProperties.getCsvFileChecksum().trim().equals(getMd5FromFile(csvFile))) {
			upToDate = false;
		}

		return upToDate;

	}

	private void initializeServer() throws Exception {

		LOGGER.info("START - Server Initilization");
		serverController = new ServerController();
		if (serverController.isServerAlreadyRunning()) {
			closeSplash();
			showMessage("The server is already running");
			simulateClickKmz();
			System.gc(); // THIS SHOULD BE REMOVED!
		} else {

			serverController.startServer(new Observer() {

				@Override
				public void update(Observable o, Object arg) {
					LOGGER.info("END - Server Initilization");
					closeSplash();
					LOGGER.info("Force opening of KMZ file in Google Earth");
					simulateClickKmz();
					LOGGER.info("Open Collect Earth swing interface");
					openMainWindow();
				}

				private void openMainWindow() {
					final LocalPropertiesService localPropertiesService = serverController.getContext().getBean(
							LocalPropertiesService.class);
					final DataExportService dataExportService = serverController.getContext().getBean(DataExportService.class);

					javax.swing.SwingUtilities.invokeLater(new Runnable() {
						@Override
						public void run() {
							CollectEarthWindow mainEarthWindow = new CollectEarthWindow(localPropertiesService,
									dataExportService, serverController);
							mainEarthWindow.openWindow();
						}
					});

				}

			});

		}
	}

	private void openInTemporaryFile() throws IOException {

		// Process the template file using the data in the "data" Map
		Configuration cfg = new Configuration();

		// Load template from source folder
		Template template = cfg.getTemplate(KML_NETWORK_LINK_TEMPLATE);

		nonSpringManagedProperties.saveGeneratedOn(System.currentTimeMillis() + "");

		Map<String, Object> data = new HashMap<String, Object>();
		data.put("host", KmlGenerator.getHostAddress(nonSpringManagedProperties.getHost(), nonSpringManagedProperties.getPort()));
		data.put("kmlGeneratedOn", nonSpringManagedProperties.getGeneratedOn());
		data.put("surveyName", nonSpringManagedProperties.getValue(SURVEY_NAME));

		// Console output
		FileWriter fw = new FileWriter(KML_NETWORK_LINK_STARTER);
		Writer out = new BufferedWriter(fw);
		try {
			// Add date to avoid caching
			template.process(data, out);
			Desktop.getDesktop().open(new File(KML_NETWORK_LINK_STARTER));

		} catch (TemplateException e) {
			LOGGER.error("Error when producing starter KML from template", e);
		}

		out.flush();
		out.close();
		fw.close();
	}

	private void showMessage(String message) {
		JOptionPane.showMessageDialog(null, message, "Collect Earth", JOptionPane.WARNING_MESSAGE);
	}

	private void simulateClickKmz() {
		try {
			if (Desktop.isDesktopSupported()) {
				openInTemporaryFile();
			} else {
				showMessage("The KMZ file cannot be open");
			}
		} catch (Exception e) {
			showMessage("The KMZ file could not be found");
			LOGGER.error("The KMZ file could not be found", e);
		}
	}

}
