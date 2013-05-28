package org.openforis.eye.desktop;

import java.awt.Desktop;
import java.awt.SplashScreen;
import java.io.File;
import java.io.IOException;
import java.util.Observable;
import java.util.Observer;

import javax.swing.JOptionPane;

import org.openforis.eye.springversion.ServerInitilizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class DesktopApp {

	final static Logger logger = LoggerFactory.getLogger(DesktopApp.class);
	ServerInitilizer serverInitilizer;
	/**
	 * @param args
	 */
	public static void main(String[] args) {

		try {

			logger.info("START - Server Initilization");
			ServerInitilizer serverInitilizer = new ServerInitilizer();
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
					}

				});
			}
		} catch (Exception e) {
			logger.error("The server could not start", e);
		} finally {

			closeSplash();
		}
	}

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

	private static void openInTemporaryFile() throws IOException {

		Desktop.getDesktop().open(new File("gePlugin.kmz"));

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

}
