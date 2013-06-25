package org.openforis.collect.earth.app.desktop;

import java.awt.Desktop;
import java.awt.SplashScreen;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.Writer;
import java.util.HashMap;
import java.util.Map;
import java.util.Observable;
import java.util.Observer;

import javax.swing.JOptionPane;

import org.openforis.collect.earth.app.service.DataExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.CollectEarthWindow;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.PolygonKmlGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

public class EarthApp {


	private static final String KML_RESULTING_TEMP_FILE = "generated/plots.kml";
	final static Logger logger = LoggerFactory.getLogger(EarthApp.class);
	private static ServerController serverInitilizer;
	private static final String KMZ_FILE_PATH = "generated/gePlugin.kmz";
	private final LocalPropertiesService localPropertiesService = new LocalPropertiesService();

	private static final String KML_NETWORK_LINK_TEMPLATE = "resources/loadApp.fmt";
	private static final String KML_NETWORK_LINK_STARTER = "generated/loadApp.kml";

	private static void closeSplash() {
		try {
			logger.info("Close splash if shown");
			SplashScreen splash = SplashScreen.getSplashScreen();
			if (splash != null) {
				splash.close();
				logger.info("Splash closed");
			}
		} catch (IllegalStateException e) {
			logger.error("Error closing splash window", e);
		}
	}

	public static ServerController getServerInitilizer() {
		return serverInitilizer;
	}

	/**
	 * @param args
	 */
	public static void main(String[] args) {

		try {

			EarthApp earthApp = new EarthApp();

			earthApp.generateKml();
			earthApp.initializeServer();

		} catch (Exception e) {
			logger.error("The server could not start", e);
		} finally {

			closeSplash();
		}
	}

	public EarthApp() {
		localPropertiesService.init();
	}

	private void generateKml() {

		logger.info("START - Generate KML file");
		// KmlGenerator generateKml = new OnePointKmlGenerator();
		KmlGenerator generateKml = new PolygonKmlGenerator("EPSG:3576", localPropertiesService.getHost(),
				localPropertiesService.getPort());
		try {

			generateKml.generateFromCsv(localPropertiesService.getValue("csv"), localPropertiesService.getValue("balloon"),
					localPropertiesService.getValue("template"), KML_RESULTING_TEMP_FILE);
		} catch (IOException e) {
			logger.error("Could not generate KML file", e);
		} catch (TemplateException e) {
			logger.error("Problems using the Freemarker template file." + e.getFTLInstructionStack(), e);
		}

		logger.info("END - Generate KML file");

	}

	private void generateKmzFile() {

		logger.info("START - Generate KMZ file");

		generateKml();

		try {
			KmzGenerator.generateKmzFile(KMZ_FILE_PATH, KML_RESULTING_TEMP_FILE, null); // "mongolia_files/files"
			logger.info("KMZ File generated : " + KMZ_FILE_PATH);

			File kmlFile = new File(KML_RESULTING_TEMP_FILE);
			if (kmlFile.exists()) {
				kmlFile.delete();
				logger.info("KML File deleted : " + KML_RESULTING_TEMP_FILE);
			}


		} catch (IOException e) {
			logger.error("Error while generating KMZ file", e);
		}

		logger.info("END - Generate KMZ file");
	}

	private void initializeServer() throws Exception {

		logger.info("START - Server Initilization");
		serverInitilizer = new ServerController();
		if (serverInitilizer.isServerAlreadyRunning()) {
			closeSplash();
			showMessage("The server is already running");
			simulateClickKmz();
			System.gc(); // THIS SHOULD BE REMOVED!
		} else {


			serverInitilizer.startServer(new Observer() {

				@Override
				public void update(Observable o, Object arg) {

					logger.info("END - Server Initilization");
					closeSplash();
					simulateClickKmz();

					openMainWindow();
				}

				private void openMainWindow() {
					LocalPropertiesService localPropertiesService = serverInitilizer.getContext().getBean(
							LocalPropertiesService.class);
					DataExportService dataExportService = serverInitilizer.getContext().getBean(DataExportService.class);

					CollectEarthWindow mainEarthWindow = new CollectEarthWindow(localPropertiesService, dataExportService);
					mainEarthWindow.createWindow();
				}

			});

		}
	}

	private void openInTemporaryFile() throws IOException {

		// Process the template file using the data in the "data" Map
		Configuration cfg = new Configuration();

		// Load template from source folder
		Template template = cfg.getTemplate(KML_NETWORK_LINK_TEMPLATE);

		localPropertiesService.saveGeneratedOn(System.currentTimeMillis() + "");

		Map<String, Object> data = new HashMap<String, Object>();
		data.put("host", KmlGenerator.getHostAddress(localPropertiesService.getHost(), localPropertiesService.getPort()));
		data.put("kmlGeneratedOn", localPropertiesService.getGeneratedOn());

		// Console output
		FileWriter fw = new FileWriter(KML_NETWORK_LINK_STARTER);
		Writer out = new BufferedWriter(fw);
		try {
			// Add date to avoid caching
			template.process(data, out);
			Desktop.getDesktop().open(new File(KML_NETWORK_LINK_STARTER));

		} catch (TemplateException e) {
			logger.error("Error when producing starter KML from template", e);
		}
		out.flush();
		fw.close();



		// InputStream resource =
		// Thread.currentThread().getContextClassLoader().getResourceAsStream("gePlugin.kmz");
		// try {
		// File file = File.createTempFile("gePlugin", ".kmz");
		// // file.deleteOnExit();
		// FileUtils.copyInputStreamToFile(resource, file);
		// Desktop.getDesktop().open(file);
		// } catch (IOException e) {
		// logger.error("Temporary file not created", e);
		// } finally {
		// if (resource != null)
		// try {
		// resource.close();
		// } catch (IOException e) {
		// logger.error("Could not close the Input Stream", e);
		// }
		// }

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
			logger.error("The KMZ file could not be found", e);
		}
	}

}
