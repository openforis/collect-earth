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
import org.openforis.collect.earth.sampler.processor.CircleKmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.KmzGenerator;
import org.openforis.collect.earth.sampler.processor.SquareKmlGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

public class EarthApp {

	private static final String KML_RESULTING_TEMP_FILE = "generated/plots.kml";
	private final static Logger LOGGER = LoggerFactory.getLogger(EarthApp.class);
	private static ServerController serverInitilizer;
	private static final String KMZ_FILE_PATH = "generated/gePlugin.kmz";
	private final LocalPropertiesService localPropertiesService = new LocalPropertiesService();

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
		localPropertiesService.init();
	}

	private void generateKml() {

		LOGGER.info("START - Generate KML file");
		// KmlGenerator generateKml = new OnePointKmlGenerator();
		KmlGenerator generateKml = null;
		if (localPropertiesService.getValue("sample_shape").equals("CIRCLE")) {
			generateKml = new CircleKmlGenerator(localPropertiesService.getValue("coordinates_reference_system"),
					localPropertiesService.getHost(),
					localPropertiesService.getPort());
		}else{
			generateKml = new SquareKmlGenerator(localPropertiesService.getValue("coordinates_reference_system"),
					localPropertiesService.getHost(),
					localPropertiesService.getPort());
		}

		try {

			generateKml.generateFromCsv(localPropertiesService.getValue("csv"), localPropertiesService.getValue("balloon"),
					localPropertiesService.getValue("template"), KML_RESULTING_TEMP_FILE,
					localPropertiesService.getValue("distance_between_sample_points"));
		} catch (IOException e) {
			LOGGER.error("Could not generate KML file", e);
		} catch (TemplateException e) {
			LOGGER.error("Problems using the Freemarker template file." + e.getFTLInstructionStack(), e);
		}

		LOGGER.info("END - Generate KML file");

	}

	private void generateKmzFile() {

		LOGGER.info("START - Generate KMZ file");

		generateKml();

		try {
			KmzGenerator kmzGenerator = new KmzGenerator();
			kmzGenerator.generateKmzFile(KMZ_FILE_PATH, KML_RESULTING_TEMP_FILE,
					localPropertiesService.getValue("include_files_kmz"));
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

		LOGGER.info("END - Generate KMZ file");
	}

	private void initializeServer() throws Exception {

		LOGGER.info("START - Server Initilization");
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

					LOGGER.info("END - Server Initilization");
					closeSplash();
					simulateClickKmz();

					openMainWindow();
				}

				private void openMainWindow() {
					final LocalPropertiesService localPropertiesService = serverInitilizer.getContext().getBean(
							LocalPropertiesService.class);
					final DataExportService dataExportService = serverInitilizer.getContext().getBean(DataExportService.class);

					javax.swing.SwingUtilities.invokeLater(new Runnable() {
						@Override
						public void run() {
							CollectEarthWindow mainEarthWindow = new CollectEarthWindow(localPropertiesService,
									dataExportService, serverInitilizer);
							mainEarthWindow.createWindow();
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
