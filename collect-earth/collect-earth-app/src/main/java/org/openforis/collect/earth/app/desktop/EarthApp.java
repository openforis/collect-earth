package org.openforis.collect.earth.app.desktop;

import java.awt.HeadlessException;
import java.awt.Image;
import java.awt.SplashScreen;
import java.awt.Window;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.net.MalformedURLException;
import java.net.Socket;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Observer;

import javax.swing.ImageIcon;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.desktop.ServerController.ServerInitializationEvent;
import org.openforis.collect.earth.app.logging.GAlogger;
import org.openforis.collect.earth.app.server.LoadProjectFileServlet;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.openforis.collect.earth.app.view.CheckForUpdatesListener;
import org.openforis.collect.earth.app.view.CollectEarthWindow;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.app.view.PropertiesDialog;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.formdev.flatlaf.FlatIntelliJLaf;
import com.formdev.flatlaf.FlatLightLaf;
import com.opencsv.exceptions.CsvValidationException;

import io.sentry.Sentry;
import io.sentry.protocol.User;

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
	 * @param args No arguments are used by this method.
	 */
	public static void main(String[] args) {

		try {

			FlatLightLaf.setup();
			try {
				UIManager.setLookAndFeel(new FlatIntelliJLaf());
			} catch (Exception ex) {
				System.err.println("Failed to initialize LaF");
			}

			// System property used in the web.xml configuration
			System.setProperty("collectEarth.userFolder", FolderFinder.getCollectEarthDataFolder()); //$NON-NLS-1$

			// Specify a browser as http.agent so that calls to CloudFlare hosted
			// OpenForis.org do not return with a 403 http error
			System.setProperty("http.agent",
					"Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10.4; en-US; rv:1.9.2.2) Gecko/20100316 Firefox/3.6.2");

			initializeSentry();

			// Change of font so that Lao and Thao glyphs are supported
			CollectEarthUtils.setFontDependingOnLanguaue(getLocalProperties().getUiLanguage());

			logger = LoggerFactory.getLogger(EarthApp.class);

			String doubleClickedProjectFile = null;

			if (args != null && args.length == 1) {
				doubleClickedProjectFile = args[0];
			} else if (getProjectsService().getProjectList().size() == 0) {
				doubleClickedProjectFile = "resources/demo_survey.cep";
			}

			if (SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX) {
				handleMacStartup(doubleClickedProjectFile);
			} else {
				startCollectEarth(doubleClickedProjectFile);
			}

		} catch (final Exception e) {
			// The logger factory has not been initialized, this will not work, just output
			// to console
			if (logger != null) {
				logger.error("The server could not start", e); //$NON-NLS-1$
			}
			System.exit(1);
		} finally {
			closeSplash();
		}
	}

	private static void initializeSentry() {
		try {
			String releaseName = UpdateIniUtils.getVersionNameInstalled();

			Sentry.init(
					"https://24dd6a90c1e4461484712db99c3b3bb7:831e42661c5c4ff3aa5eca270db3f619@sentry.io/299626?release="
							+ releaseName + "&maxmessagelength=2000");
			if (!StringUtils.isEmpty(UpdateIniUtils.getVersionReleaseDateInstalled())) {
				Sentry.setTag("ReleaseDate", UpdateIniUtils.getVersionReleaseDateInstalled());
			}
			if (!StringUtils.isEmpty(getLocalProperties().getOperator())) {
				User user = new User();
				user.setUsername(getLocalProperties().getOperator());
				Sentry.setUser(user);
			}

		} catch (Exception e) {
			logger.error("Error initializing Sentry logger", e);
		}
	}

	/**
	 * Special code that uses reflection to handle how the application should behave
	 * in Mac OS X. Without reflection the code provokes compilation-time errors.
	 * 
	 * @param doubleClickedProjectFile Project file (CEP) that was clicked
	 * @throws Exception Throws Exception when the process fails to open the file
	 *                   double-clicked. Initializes the server in any case
	 */
	@SuppressWarnings({ "rawtypes", "unchecked" })
	public static void handleMacStartup(String doubleClickedProjectFile) throws Exception {
		try {
			
			try {
				// This code is only available in Java 9 and later and in newer Mac OS versions
				setIconMacNewOS();
			} catch (Exception e) {
				logger.error("Error while defining the double-click behaviour on CEP files in NEW Mac OS X", e);
				try {
					setIconMacOldOS();
				} catch (Exception e2) {
					logger.error("Error while defining the double-click behaviour on CEP files in OLD Mac OS X", e2);
				}
				
			}
			
			// Lets wait for the Apple event to arrive. If it did then the earthApp variable
			// will be non-nulls
			Thread.sleep(2000);

		} catch (Exception e) {
			logger.error("Error while defining the double-click behaviour on CEP files in Mac OS X", e);
			
		} finally {
			if (earthApp == null) {
				logger.info("Collect Earth started by double-clicking a CEP file in Mac OS X " + doubleClickedProjectFile);
				startCollectEarth(doubleClickedProjectFile);
			} else {
				logger.info("Collect Earth started but no CEP file loaded in Mac OS X");
				startCollectEarth(null);
			}
		}
	}

	private static void setIconMacOldOS()
			throws ClassNotFoundException, NoSuchMethodException, IllegalAccessException, InvocationTargetException {
		Class applicationClass = Class.forName("com.apple.eawt.Application");
		Method getApplicationMethod = applicationClass.getMethod("getApplication");
		Method setDockIconImageMethod = applicationClass.getMethod("setDockIconImage", Image.class);

		Class openFilesHandlerInterface = Class.forName("com.apple.eawt.OpenFilesHandler");
		Method setOpenFileHandlerMethod = applicationClass.getMethod("setOpenFileHandler",
				openFilesHandlerInterface);

		// SET THE MAC OS X DOCK ICON!
		// Get an Application object
		Object applicationObject = getApplicationMethod.invoke(null);
		try {
			Image dockIconImage = new ImageIcon(new File("images/dockIconMac.png").toURI().toURL()).getImage();
			// Invoke the setDockIconImage on the application object using the dockIconImage
			// as an argument
			setDockIconImageMethod.invoke(applicationObject, dockIconImage);
		} catch (MalformedURLException e2) {
			logger.error("Problems finding the docker icon", e2);
		}
		// -------------------------------------------

		// DEFINE A LISTENER THAT IS REGISTERED BY THE OS TO HEAR DOUBLE-CLICK EVENTS
		// AND REGISTER ITSELF AS THE CEP OPENER
		MacOpenFilesInvocationHandler macOpenFileHandlerProxyInterface = new MacOpenFilesInvocationHandler();
		Object openFilesHandlerImplementation = Proxy.newProxyInstance(applicationClass.getClassLoader(),
				new Class[] { openFilesHandlerInterface }, macOpenFileHandlerProxyInterface);

		// Call the setOpenFileHandler method of the application object using the
		setOpenFileHandlerMethod.invoke(applicationObject,
				(openFilesHandlerInterface.cast(openFilesHandlerImplementation)));
	}
	

	private static void setIconMacNewOS()
			throws ClassNotFoundException, NoSuchMethodException, IllegalAccessException, InvocationTargetException {
		// SET THE MAC OS X DOCK ICON!
		// Get an Application object
		Object taskbarObject;
		Object desktopObject;
 
		Class taskbarClass = Class.forName("java.awt.Taskbar");
		Class desktopClass = Class.forName("java.awt.Desktop");
		Method getTaskBarMethod = taskbarClass.getMethod("getTaskbar");
		Method getDesktopMethod = desktopClass.getMethod("getDesktop");
		Method setIconImage = taskbarClass.getMethod("setIconImage", Image.class);
 
		Class openFilesHandlerInterface = Class.forName("java.awt.desktop.OpenFilesHandler");
		Method setOpenFileHandlerMethod = desktopClass.getMethod("setOpenFileHandler",
				openFilesHandlerInterface);
 
		taskbarObject = getTaskBarMethod.invoke(null);
		try {
			Image dockIconImage = new ImageIcon(new File("images/dockIconMac.png").toURI().toURL()).getImage();
			// Invoke the setDockIconImage on the application object using the dockIconImage
			// as an argument
			setIconImage.invoke(taskbarObject, dockIconImage);
		} catch (MalformedURLException e2) {
			logger.error("Problems finding the docker icon", e2);
		}
		// -------------------------------------------
 
		// DEFINE A LISTENER THAT IS REGISTERED BY THE OS TO HEAR DOUBLE-CLICK EVENTS
		// AND REGISTER ITSELF AS THE CEP OPENER
		MacOpenFilesInvocationHandlerNewIos macOpenFileHandlerProxyInterface = new MacOpenFilesInvocationHandlerNewIos();
		Object openFilesHandlerImplementation = Proxy.newProxyInstance(desktopClass.getClassLoader(),
				new Class[] { openFilesHandlerInterface }, macOpenFileHandlerProxyInterface);
 
		desktopObject = getDesktopMethod.invoke(null);
 
		// Call the setOpenFileHandler method of the application object using the
		setOpenFileHandlerMethod.invoke(desktopObject,
				(openFilesHandlerInterface.cast(openFilesHandlerImplementation)));
	}

	public void generateKml() {

		try {
			getKmlGeneratorService().generateKmlFile();
		} catch (final KmlGenerationException e) {
			logger.error("Problems while generating the KML file ", e); //$NON-NLS-1$
			showMessage("<html>Problems while generating the KML file: <br/> " //$NON-NLS-1$
					+ (e.getCause() != null ? (e.getCause() + "<br/>") : "")
					+ (e.getMessage().length() > 300 ? e.getMessage().substring(0, 300) : e.getMessage()) + "</html>");
		} catch (final Exception e) {
			logger.error("Could not generate KML file", e); //$NON-NLS-1$
			showMessage("<html>Error generating KML file : <br/> " + e.getMessage()); //$NON-NLS-1$
		}
	}

	public static void openProjectFileInRunningCollectEarth(String doubleClickedProjecFile) throws IOException {
		final File projectFile = new File(doubleClickedProjecFile);

		if (projectFile.exists()) {

			String hostAddress = ServerController.getHostAddress(getLocalProperties().getHost(),
					getLocalProperties().getPort());

			URL loadProjectFileInRunningCE = new URL(hostAddress + LoadProjectFileServlet.SERVLET_NAME + "?" //$NON-NLS-1$
					+ LoadProjectFileServlet.PROJECT_FILE_PARAMETER + "=" + //$NON-NLS-1$
					URLEncoder.encode(doubleClickedProjecFile, StandardCharsets.UTF_8.name()));
			URLConnection urlConn = loadProjectFileInRunningCE.openConnection();

			try (BufferedReader in = new BufferedReader(new InputStreamReader(urlConn.getInputStream()))) {
				String inputLine;
				while ((inputLine = in.readLine()) != null) {
					logger.info(inputLine);
				}
			}

		}
	}

	private static boolean isAnotherCollectEarthRunning(LocalPropertiesService localProperties) {
		boolean alreadyRunning = false;
		try {
			new Socket(LocalPropertiesService.LOCAL_HOST, Integer.parseInt(localProperties.getPort())).close(); // $NON-NLS-1$
			// If here there is something is serving on port 8028
			// So stop it
			logger.warn("There is a server already running {}", localProperties.getPort()); //$NON-NLS-1$
			alreadyRunning = true;
		} catch (final IOException e) {
			// Nothing there, so OK to proceed
			logger.info("There is no server running in port {}", localProperties.getPort()); //$NON-NLS-1$
			alreadyRunning = false;
		} catch (final NumberFormatException e) {
			// Nothing there, so OK to proceed
			logger.info("Error parsing integer value {}", localProperties.getPort()); //$NON-NLS-1$
			alreadyRunning = false;
		}
		return alreadyRunning;
	}

	public static void quitServer() {
		try {
			serverController.stopServer();
		} catch (Exception e) {
			logger.error("Error stoping server", e); //$NON-NLS-1$
		}
	}

	/**
	 * Generates the KML for the project and opens it in Google Earth
	 * 
	 * @param forceKmlRecreation Set to true if you want to forece the regeneration
	 *                           of the KML even if is is up to date (you might want
	 *                           to do this to force the update of the placemark
	 *                           icons as the date changes)
	 * @throws IOException            Throws exception if the KMl file cannot be
	 *                                generated
	 * @throws KmlGenerationException Throws exception if the KML file contents
	 *                                cannot be generated
	 * @throws CsvValidationException
	 */
	private static synchronized void loadKmlInGoogleEarth(boolean forceKmlRecreation)
			throws IOException, KmlGenerationException, CsvValidationException {
		earthApp.getKmlGeneratorService().generatePlacemarksKmzFile(forceKmlRecreation);
		earthApp.simulateClickKmz();
	}

	public static void restart() {
		try {

			serverController.stopServer();
			startServer(null);

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

	private static EarthProjectsService getProjectsService() {
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

	private static void startCollectEarth(final String doubleClickedProjectFile) throws Exception {
		logger.info("START - Server Initilization"); //$NON-NLS-1$
		final boolean ceAlreadyOpen = isAnotherCollectEarthRunning(getLocalProperties());

		if (ceAlreadyOpen) {
			closeSplash();
			// If the user double clicked on a project file while Collect Earth is running
			// then load the project in the running Collect Earth
			if (doubleClickedProjectFile != null) {
				openProjectFileInRunningCollectEarth(doubleClickedProjectFile);
			} else {
				JOptionPane.showMessageDialog(null, Messages.getString("EarthApp.11"), "Collect Earth",
						JOptionPane.WARNING_MESSAGE);
				// showMessage(Messages.getString("EarthApp.11")); //$NON-NLS-1$
				logger.warn("Closing CE - port already in use");
				System.exit(1);
			}
		} else {

			startServer(doubleClickedProjectFile);

		}

		GAlogger.logGAnalytics("StartCollectEarth");
	}

	public static void startServer(final String doubleClickedProjectFile) throws Exception {
		earthApp = new EarthApp();

		// Load the double-clicked CEP file before the survey manager is instantiated by
		// the server start-up
		earthApp.loadProjectIfDoubleClicked(doubleClickedProjectFile);

		final Observer observeInitialization = getServerObserver();
		serverStartAndOpenGe(observeInitialization);
	}

	private static Observer getServerObserver() {
		return (observable, initializationEvent) -> {
			if (initializationEvent.equals(ServerInitializationEvent.SERVER_STARTED_NO_DB_CONNECTION_EVENT)) {
				serverController = null;
			}

			if (initializationEvent.equals(ServerInitializationEvent.SERVER_STARTED_WITH_DATABASE_CHANGE_EVENT)
					|| initializationEvent.equals(ServerInitializationEvent.SERVER_STARTED_NO_DB_CONNECTION_EVENT)) {

				showMessage(initializationEvent.toString());
			}

			if (!initializationEvent.equals(ServerInitializationEvent.SERVER_STOPPED_EVENT)) {
				try {
					earthApp.generateKml();
					earthApp.simulateClickKmz();
					earthApp.checkForUpdates();
					closeSplash();
				} catch (final Exception e) {
					logger.error("Error generating KML file", e); //$NON-NLS-1$
				}
			}
		};
	}

	private void openKmlOnGoogleEarth() {
		if (!CollectEarthUtils.openFile(new File(KmlGeneratorService.KML_NETWORK_LINK_STARTER))) {
			showMessage("The KML file cannot be open at " + KmlGeneratorService.KML_NETWORK_LINK_STARTER); //$NON-NLS-1$
		}
	}

	private void checkForUpdates() {
		new Thread("Check for new Collect Earth versions on the server") {
			@Override
			public void run() {

				// Wait a few seconds before checking for updates
				try {
					Thread.sleep(10000);
				} catch (InterruptedException e1) {
					logger.error("Error while waiting", e1); //$NON-NLS-1$
				}

				final UpdateIniUtils updateIniUtils = new UpdateIniUtils();

				if (updateIniUtils.shouldWarnUser(getLocalProperties()) ) {

					javax.swing.SwingUtilities.invokeLater(() -> {

						try {
							Object[] possibleValues = new Object[3];
							String newestVersionOnline = updateIniUtils.getVersionAvailableOnline();
							if (StringUtils.isNotBlank(newestVersionOnline)) {
								String remindLater = Messages.getString("EarthApp.3"); //$NON-NLS-1$
								String doNotBother = Messages.getString("EarthApp.5"); //$NON-NLS-1$
								String downloadInstaller = Messages.getString("EarthApp.51"); //$NON-NLS-1$
								String doItNow = Messages.getString("EarthApp.4"); //$NON-NLS-1$

								possibleValues[0] = remindLater;
								possibleValues[2] = doNotBother;

								// The updater does not work any more on Mac, instead of updating we ask the
								// user to download the installer full!
								if (SystemUtils.IS_OS_MAC) {
									possibleValues[1] = downloadInstaller;
								} else {
									possibleValues[1] = doItNow;
								}
								String versionDate = StringUtils.isNotBlank(newestVersionOnline)?updateIniUtils.convertToDate(newestVersionOnline):"XXX";
								int chosenOption = JOptionPane.showOptionDialog(null, Messages.getString("EarthApp.57"),//$NON-NLS-1$
										Messages.getString("EarthApp.58") + Messages.getString("EarthApp.6") //$NON-NLS-1$ //$NON-NLS-2$
												+ versionDate,
										JOptionPane.DEFAULT_OPTION, JOptionPane.INFORMATION_MESSAGE, null, possibleValues,
										possibleValues[0]);
								
								if (chosenOption != JOptionPane.CLOSED_OPTION) {
									if (possibleValues[chosenOption].equals(downloadInstaller)) { // For Mac
										try {
											CollectEarthUtils.openUrl( new URI("https://oss.sonatype.org/service/local/artifact/maven/redirect?r=releases&g=org.openforis.collect.earth&a=collect-earth-installer&v=LATEST&c=osx&e=dmg"));
										} catch (URISyntaxException e) {
											logger.error("Error getting installer", e );
										}
									} else if (possibleValues[chosenOption].equals(doItNow)) { // For Linux and Windows
										CheckForUpdatesListener checkForUpdatesListener = new CheckForUpdatesListener();
										checkForUpdatesListener.actionPerformed(null);
									} else if (possibleValues[chosenOption].equals(doNotBother)) {
										getLocalProperties().setValue(EarthProperty.LAST_IGNORED_UPDATE,
												newestVersionOnline);
									}
								}

							}
						} catch (HeadlessException e) {
							logger.error( "Error checking for updates",  e);
						}
					});
				}
			}
		}.start();

	}

	/**
	 * If Collect Earth is started by double clicking on a ".cep" file ( Collect
	 * Earth Project file ) Then it should open directly with that project in focus
	 *
	 * @param doubleClickedProjecFile The path to the CEP file that was
	 *                                double-clicked
	 *
	 */
	private void loadProjectIfDoubleClicked(String doubleClickedProjectFile) {
		try {
			if (doubleClickedProjectFile != null) {

				final File projectFile = new File(doubleClickedProjectFile);

				if (projectFile.exists()) {
					getProjectsService().loadCompressedProjectFile(projectFile);
				}
			}
		} catch (final Exception e) {
			showMessage(Messages.getString("EarthApp.59")); //$NON-NLS-1$
			logger.error(Messages.getString("EarthApp.59"), e);//$NON-NLS-1$
		}
	}

	private static void serverStartAndOpenGe(Observer observeInitialization) throws Exception {
		serverController = new ServerController();
		serverController.deleteObservers();
		serverController.startServer(observeInitialization);

		// Inform Mac OS users of the issues about opening CEP files in the Mac version
		// of CE
		if (SystemUtils.IS_OS_MAC_OSX) {
			showMessage("<html>" //$NON-NLS-1$
					+ "<b>" //$NON-NLS-1$
					+ Messages.getString("EarthApp.70") + "</b>: " //$NON-NLS-2$
					+ Messages.getString("EarthApp.71") + Messages.getString("EarthApp.72") + "<b>" //$NON-NLS-3$
					+ Messages.getString("CollectEarthWindow.10") + " -> " //$NON-NLS-2$
					+ Messages.getString("CollectEarthMenu.0") + "</b></html>", //$NON-NLS-2$
					Messages.getString("EarthApp.73"));
		}
	}

	public static void showMessage(String message) {
		showMessage(message, "Collect Earth");

	}

	public static void showMessage(String message, String title) {
		try {
			SwingUtilities.invokeLater(
					() -> JOptionPane.showMessageDialog(null, message, title, JOptionPane.WARNING_MESSAGE));
		} catch (Exception e) {
			logger.error("Error showing message", e);
		}

	}

	private void simulateClickKmz() {
		try {
			getKmlGeneratorService().generateLoaderKmlFile();
			openKmlOnGoogleEarth();
		} catch (final Exception e) {
			showMessage(Messages.getString("EarthApp.61")); //$NON-NLS-1$
			logger.error("The KMZ file could not be found", e); //$NON-NLS-1$
		}
	}

	public static void executeKmlLoadAsynchronously(Window windowShowingTimer) {
		new Thread("Load KML in Google Earth") {
			@Override
			public void run() {
				// Only regenerate KML and reload
				try {
					SwingUtilities.invokeLater(() -> {
						if (windowShowingTimer != null) {
							CollectEarthWindow.startWaiting(windowShowingTimer);
						}
					});

					EarthApp.loadKmlInGoogleEarth(true);

				} catch (Exception e) {
					logger.error("Error loading the KML", e);
					EarthApp.showMessage("<html>Problems while generating the KML file: <br/> "
							+ (e.getCause() != null ? (e.getCause() + "<br/>") : "")
							+ ((e.getMessage() != null && e.getMessage().length() > 300)
									? e.getMessage().substring(0, 300)
									: (e.getMessage() != null) ? e.getMessage() : "")
							+ "</html>"); //$NON-NLS-1$
				} finally {
					if (windowShowingTimer != null) {
						try {
							SwingUtilities.invokeLater(() -> {
								CollectEarthWindow.endWaiting(windowShowingTimer);
								if (windowShowingTimer instanceof PropertiesDialog) {
									((PropertiesDialog) windowShowingTimer).closeDialog();
								}
							});
						} catch (Exception e2) {
							logger.error("Error closing Options dialog", e2);
						}
					}
				}

			}
		}.start();
	}

}
