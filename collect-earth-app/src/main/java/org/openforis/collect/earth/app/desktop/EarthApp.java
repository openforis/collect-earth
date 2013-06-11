package org.openforis.collect.earth.app.desktop;

import java.awt.Desktop;
import java.awt.SplashScreen;
import java.io.File;
import java.io.IOException;
import java.util.Observable;
import java.util.Observer;

import javax.swing.JOptionPane;

import org.openforis.collect.earth.app.service.DataExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.CollectEarthWindow;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.MultiPointKmlGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import freemarker.template.TemplateException;

public class EarthApp {

	final static Logger logger = LoggerFactory.getLogger(EarthApp.class);
	private static ServerController serverInitilizer;
	private static final String KMZ_FILE_PATH = "gePlugin.kmz";

	private static void closeSplash() {
		try {
			logger.info("Close splash if shown");
			SplashScreen splash = SplashScreen.getSplashScreen();
			if (splash != null) {
				splash.close();
				logger.info("Splash closed");
			}
		} catch (IllegalStateException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
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

			generateKmzFile();

			initializeServer();

		} catch (Exception e) {
			logger.error("The server could not start", e);
		} finally {

			closeSplash();
		}
	}

	private static void generateKmzFile() {
		LocalPropertiesService localPropertiesService = new LocalPropertiesService();
		localPropertiesService.init();

		logger.info("START - Generate KMZ file");

		// KmlGenerator generateKml = new OnePointKmlGenerator();
		KmlGenerator generateKml = new MultiPointKmlGenerator("EPSG:3576", localPropertiesService.getHost(),
				localPropertiesService.getPort());
		try {

			String kmlResult = "resultAnssi.kml";


			generateKml.generateFromCsv(localPropertiesService.getValue("csv"), localPropertiesService.getValue("balloon"),
					localPropertiesService.getValue("template"), kmlResult);

			logger.info("KML File generated : " + kmlResult);

			KmzGenerator.generateKmzFile(KMZ_FILE_PATH, kmlResult, "mongolia_files/files");

			logger.info("KMZ File generated : " + KMZ_FILE_PATH);

		} catch (IOException e) {
			logger.error("Could not generate KML file", e);
		} catch (TemplateException e) {
			logger.error("Problems using the Freemarker template file." + e.getFTLInstructionStack(), e);
		}

		logger.info("END - Generate KMZ file");
	}

	private static void initializeServer() throws Exception {

		logger.info("START - Server Initilization");
		serverInitilizer = new ServerController();
		if (serverInitilizer.isServerAlreadyRunning()) {
			closeSplash();
			showMessage("The server is already running");
			simulateClickKmz();
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

					CollectEarthWindow mainEyeFrame = new CollectEarthWindow(localPropertiesService, dataExportService);
					mainEyeFrame.createWindow();
				}

			});

		}
	}

	private static void openInTemporaryFile() throws IOException {

		Desktop.getDesktop().open(new File(KMZ_FILE_PATH));

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

	private static void showMessage(String message) {
		JOptionPane.showMessageDialog(null, message, "OpenForis Eye", JOptionPane.WARNING_MESSAGE);
	}

	private static void simulateClickKmz() {
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
