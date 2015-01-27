package org.openforis.collect.earth.app.desktop;

import java.awt.Desktop;
import java.awt.SplashScreen;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.MalformedURLException;
import java.net.Socket;
import java.net.URL;
import java.net.URLConnection;
import java.util.Observable;
import java.util.Observer;

import javax.swing.JOptionPane;

import org.openforis.collect.earth.app.server.LoadProjectFileServlet;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.openforis.collect.earth.app.view.CheckForUpdatesListener;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Contains the main class that starts Collect Earth and opens Google Earth.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
public class EarthApp {

	private static Logger logger;
	private static ServerController serverController;
	private static EarthApp earthApp;

	private static void closeSplash() {
		try {
			final SplashScreen splash = SplashScreen.getSplashScreen();
			if (splash != null) {
				splash.close();
			}
		} catch (final IllegalStateException e) {
			logger.error("Error closing the splash window", e); //$NON-NLS-1$
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

			// System property used in the log4j.properties configuration
			System.setProperty("collectEarth.userFolder", FolderFinder.getLocalFolder()); //$NON-NLS-1$

			logger = LoggerFactory.getLogger(EarthApp.class);

			String doubleClickedProjecFile = null;

			if (args != null && args.length == 1) {
				doubleClickedProjecFile = args[0];
			}

			initializeServer( doubleClickedProjecFile );

		} catch (final Exception e) {
			// The logger factory has not been initialized, this will not work, just output to console
			if (logger != null) {
				logger.error("The server could not start", e); //$NON-NLS-1$
			}
			e.printStackTrace();
			System.exit(1);
		} finally {
			closeSplash();
		}
	}

	public void openProject(String doubleClickedProjectFile) throws MalformedURLException, IOException, Exception {
	

			earthApp.loadProjectIfDoubleCLicked(doubleClickedProjectFile);

			try {

				getKmlGeneratorService().generateKmlFile();

			} catch (final IOException e) {
				logger.error("Could not generate KML file", e); //$NON-NLS-1$
				showMessage("Error generating KML file : <br/> " + e.getMessage()); //$NON-NLS-1$
			} catch (final KmlGenerationException e) {
				logger.error("Problems while generating the KML file ", e); //$NON-NLS-1$
				showMessage("Problems while generating the KML file: \r\n " + e.getCause()); //$NON-NLS-1$
			}

			earthApp.checkForUpdates();
	}

	public static void openProjectFileInRunningCollectEarth(String doubleClickedProjecFile) throws MalformedURLException, IOException {
		final File projectFile = new File(doubleClickedProjecFile);

		if (projectFile.exists()) {

			String hostAddress = ServerController.getHostAddress( getLocalProperties().getHost(), getLocalProperties().getPort());

			URL loadPfojectFileInRunningCE = new URL(hostAddress + LoadProjectFileServlet.SERVLET_NAME +  
					"?" + LoadProjectFileServlet.PROJECT_FILE_PARAMETER + "=" + //$NON-NLS-1$ //$NON-NLS-2$
					doubleClickedProjecFile);
			URLConnection urlConn = loadPfojectFileInRunningCE.openConnection();

			BufferedReader in = new BufferedReader(new InputStreamReader(urlConn.getInputStream()));
			String inputLine;

			while ((inputLine = in.readLine()) != null) {
				System.out.println(inputLine);
			}
			in.close();

		}
	}

	private static boolean isAnotherCollectEarthRunning(LocalPropertiesService localProperties) {
		boolean alreadyRunning = false;
		try {
			new Socket("127.0.0.1", Integer.parseInt(localProperties.getPort())).close(); //$NON-NLS-1$
			// If here there is something is serving on port 8888
			// So stop it
			logger.warn("There is a server already running " + localProperties.getPort()); //$NON-NLS-1$
			alreadyRunning = true;
		} catch (final IOException e) {
			// Nothing there, so OK to proceed
			logger.info("There is no server running in port " + localProperties.getPort()); //$NON-NLS-1$
			alreadyRunning = false;
		} catch (final NumberFormatException e) {
			// Nothing there, so OK to proceed
			logger.info("Error parsing integer value " + localProperties.getPort()); //$NON-NLS-1$
			e.printStackTrace();
			alreadyRunning = false;
		}
		return alreadyRunning;
	}

	public static void restart() {
		try {

			serverController.stopServer();

			final Observer observeInitializationAfterRestart = new Observer() {

				@Override
				public void update(Observable o, Object arg) {
					try {
						if (arg.equals(ServerController.SERVER_STARTED_EVENT)) {
							earthApp.getKmlGeneratorService().generatePlacemarksKmzFile();
							earthApp.simulateClickKmz();
						}
					} catch (final IOException e) {
						logger.error("Error generating KMZ file", e); //$NON-NLS-1$
					} catch (final Exception e) {
						logger.error("Error starting server", e); //$NON-NLS-1$
						e.printStackTrace();
					}

				}

			};

			serverStartAndOpenGe(observeInitializationAfterRestart);

		} catch (final Exception e) {
			logger.error("Error while stopping server", e); //$NON-NLS-1$
		}
	}

	private static LocalPropertiesService nonManagedPropertiesService;
	

	private static LocalPropertiesService getLocalProperties() {
		if (serverController == null || serverController.getContext() == null) {
			if (nonManagedPropertiesService == null) {
				nonManagedPropertiesService = new LocalPropertiesService();
			}
			return nonManagedPropertiesService;
		} else {
			return serverController.getContext().getBean(LocalPropertiesService.class);
		}
	}

	private EarthProjectsService getProjectsService() {
		if (serverController != null) {
			return serverController.getContext().getBean(EarthProjectsService.class);
		} else {
			final EarthProjectsService earthProjectsService = new EarthProjectsService();
			earthProjectsService.init(getLocalProperties());
			return earthProjectsService;
		}
	}


	private KmlGeneratorService getKmlGeneratorService() {
		if (serverController != null) {
			return serverController.getContext().getBean(KmlGeneratorService.class);
		} else {
			throw new IllegalStateException("The server must be initialized before this method is called"); //$NON-NLS-1$
		}
	}

	private static void initializeServer(final String doubleClickedProjectFile) throws Exception {
		logger.info("START - Server Initilization"); //$NON-NLS-1$
		final boolean ceAlreadyOpen = isAnotherCollectEarthRunning( getLocalProperties());
		earthApp = new EarthApp();
		
		if( ceAlreadyOpen ){
			closeSplash();
			// If the user double clicked on a project file while Collect Earth is running then load the project in the running Collect Earth		
			if (doubleClickedProjectFile!=null) {
				openProjectFileInRunningCollectEarth(doubleClickedProjectFile);
			}else{
				earthApp.showMessage(Messages.getString("EarthApp.11")); //$NON-NLS-1$
			}
		}else{

			serverController = new ServerController();
			final Observer observeInitialization = new Observer() {
				@Override
				public void update(Observable o, Object arg) {
					if (arg.equals(ServerController.SERVER_STARTED_WITH_EXCEPTION_EVENT)) {
						serverController = null;
					}
					if (!arg.equals(ServerController.SERVER_STOPPED_EVENT)) {
						try {
												
							earthApp.openProject(doubleClickedProjectFile);
							earthApp.simulateClickKmz();
							
							closeSplash();
						} catch (final Exception e) {
							logger.error("Error generating KML file", e); //$NON-NLS-1$
							e.printStackTrace();
						}
					}
				}
			};
			serverStartAndOpenGe(observeInitialization);
		}
	}

	private void openGoogleEarth() throws IOException {
		if (Desktop.isDesktopSupported()) {
			Desktop.getDesktop().open(new File(KmlGeneratorService.KML_NETWORK_LINK_STARTER));
		} else {
			showMessage("The KMZ file cannot be open"); //$NON-NLS-1$
		}
	}

	private void checkForUpdates() {
		new Thread() {
			@Override
			public void run() {

				// Wait a few seconds before checking for uodates
				try {
					Thread.sleep(10000);
				} catch (InterruptedException e1) {
					logger.error("Error while waiting", e1); //$NON-NLS-1$
				}

				final UpdateIniUtils updateIniUtils = new UpdateIniUtils();
				final String newVersionAvailable = updateIniUtils.getNewVersionAvailable("update.ini"); //$NON-NLS-1$
				if (updateIniUtils.shouldWarnUser(newVersionAvailable, getLocalProperties())) {

					javax.swing.SwingUtilities.invokeLater(new Runnable() {
						@Override
						public void run() {

							String remindLater = Messages.getString("EarthApp.3"); //$NON-NLS-1$
							String doItNow = Messages.getString("EarthApp.4"); //$NON-NLS-1$
							String doNotBother = Messages.getString("EarthApp.5"); //$NON-NLS-1$
							Object[] possibleValues = { remindLater, doItNow, doNotBother };
							int chosenOption = JOptionPane.showOptionDialog(null,
									Messages.getString("EarthApp.57"), Messages.getString("EarthApp.58") + Messages.getString("EarthApp.6") + updateIniUtils.convertToDate(newVersionAvailable),  //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
									JOptionPane.DEFAULT_OPTION, JOptionPane.INFORMATION_MESSAGE, null, possibleValues, possibleValues[0]);
							if (possibleValues[chosenOption].equals(doItNow)) {
								CheckForUpdatesListener checkForUpdatesListener = new CheckForUpdatesListener();
								checkForUpdatesListener.actionPerformed(null);
							} else if (possibleValues[chosenOption].equals(doNotBother)) {
								getLocalProperties().setValue(EarthProperty.LAST_IGNORED_UPDATE, newVersionAvailable);
							}
						}
					});
				}
			};
		}.start();

	}

	/**
	 * If Collect Earth is started by double clicking on a ".cep" file ( Collect Earth Project file )
	 * Then it should open directly with that project in focus
	 * 
	 * @param doubleClickedProjecFile
	 *            The path to the CEP file that was double-clicked
	 * 
	 */
	private void loadProjectIfDoubleCLicked(String doubleClickedProjecFile) {
		try {
			if (doubleClickedProjecFile != null) {

				final File projectFile = new File(doubleClickedProjecFile);

				if (projectFile.exists()) {
					getProjectsService().loadCompressedProjectFile(projectFile);
				}
			}
		} catch (final Exception e) {
			e.printStackTrace();
			showMessage(Messages.getString("EarthApp.59")); //$NON-NLS-1$
			logger.error(Messages.getString("EarthApp.59"), e);//$NON-NLS-1$
		}
	}

	private static void serverStartAndOpenGe(Observer observeInitialization) throws IOException, Exception {

		serverController.deleteObservers();
		serverController.startServer(observeInitialization);

	}

	private void showMessage(String message) {
		JOptionPane.showMessageDialog(null, message, "Collect Earth", JOptionPane.WARNING_MESSAGE); //$NON-NLS-1$
	}

	private void simulateClickKmz() {
		try {
			getKmlGeneratorService().generateLoaderKmlFile();
			openGoogleEarth();
		} catch (final Exception e) {
			e.printStackTrace();
			showMessage(Messages.getString("EarthApp.61")); //$NON-NLS-1$
			logger.error("The KMZ file could not be found", e); //$NON-NLS-1$
		}
	}

}
