package org.openforis.collect.earth.app.desktop;

import java.awt.Desktop;
import java.awt.Image;
import java.awt.SplashScreen;
import java.awt.Window;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.net.MalformedURLException;
import java.net.Socket;
import java.net.URL;
import java.net.URLConnection;
import java.util.Observable;
import java.util.Observer;

import javax.swing.ImageIcon;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

import org.apache.commons.lang.SystemUtils;
import org.apache.log4j.PropertyConfigurator;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.desktop.ServerController.ServerInitializationEvent;
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

			// System property used in the web.xml configuration
			System.setProperty("collectEarth.userFolder", FolderFinder.getCollectEarthDataFolder()); //$NON-NLS-1$
			
			// For Log4j 1.2 --> moving to log4j 2
			//PropertyConfigurator.configure(EarthApp.class.getResource("/WEB-INF/conf/log4j.properties"));
			
			// Change of font so that Lao and Thao glyphs are supported
			CollectEarthUtils.setFontDependingOnLanguaue( getLocalProperties().getUiLanguage() );
			
			logger = LoggerFactory.getLogger(EarthApp.class);

			String doubleClickedProjectFile = null;

			if (args != null && args.length == 1) {
				doubleClickedProjectFile = args[0];
			}else if( getProjectsService().getProjectList().size() == 0 ){
				doubleClickedProjectFile = "resources/demo_survey.cep";
			}

			if ( SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX){
				handleMacStartup( doubleClickedProjectFile );
			}else{
				startCollectEarth( doubleClickedProjectFile );
			}
			
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

	
	/**
	 * Special code that uses reflection to handle how the application should behave in Mac OS X.
	 * Without reflection the code provokes compilation-time errors.
	 * @param doubleClickedProjectFile Project file (CEP) that was clicked
	 * @throws Exception Throws Exception when the process fails to open the file double-clicked. Initializes the server in any case
	 */
	@SuppressWarnings({ "rawtypes", "unchecked" })
	public static void handleMacStartup(String doubleClickedProjectFile) throws Exception{
		try {
			Class applicationClass = Class.forName("com.apple.eawt.Application");
			Method getApplicationMethod = applicationClass.getMethod("getApplication");
			Method setDockIconImageMethod = applicationClass.getMethod( "setDockIconImage", Image.class );
			
			Class openFilesHandlerInterface = Class.forName("com.apple.eawt.OpenFilesHandler");
			Method setOpenFileHandlerMethod = applicationClass.getMethod( "setOpenFileHandler", openFilesHandlerInterface );
			
			// SET THE MAC OS X DOCK ICON!
			// Get an Application object
			Object applicationObject  =  getApplicationMethod.invoke( null );
			try {	
				Image dockIconImage = new ImageIcon(new File("images/largeOpenForisIcon.jpg").toURI().toURL()).getImage();
				// Invoke the setDockIconImage on the application object using the dockIconImage as an argument
				setDockIconImageMethod.invoke(applicationObject, dockIconImage );
			} catch (MalformedURLException e2) {
				logger.error("Problems finding the doccker icon", e2);			
			}			
			// -------------------------------------------
			
			
			// DEFINE A LISTENER THAT IS REGISTERED BY THE OS TO HEAR DOUBLE-CLICK EVENTS AND REGISTER ITSELF AS THE CEP OPENER
			MacOpenFilesInvocationHandler macOpenFileHandlerProxyInterface = new MacOpenFilesInvocationHandler();
			Object openFilesHandlerImplementation = Proxy.newProxyInstance( 
					applicationClass.getClassLoader(), 
					new Class[]{ openFilesHandlerInterface },	
					macOpenFileHandlerProxyInterface 
			);
			
			// Call the setOpenFileHandler method of the application object using the 
			setOpenFileHandlerMethod.invoke(applicationObject, ( openFilesHandlerInterface.cast( openFilesHandlerImplementation ) ) );
			
			// Lets wait for the Apple event to arrive. If it did then the earthApp variable will be non-nulls 
			Thread.sleep(2000);
			if( earthApp == null ){
				startCollectEarth( doubleClickedProjectFile );
			}
		} catch (Exception e) {
			logger.error("Error while defining the double-click behaviour on CEP files in Mac OS X", e);
			startCollectEarth( null );
		}
	}

	public void generateKml() throws MalformedURLException, IOException, Exception {
	
			try {
				getKmlGeneratorService().generateKmlFile();
			} catch (final KmlGenerationException e) {
				logger.error("Problems while generating the KML file ", e); //$NON-NLS-1$
				e.printStackTrace();
				showMessage("<html>Problems while generating the KML file: <br/> " + (e.getCause()!=null?(e.getCause()+"<br/>"):"") + ( e.getMessage().length() > 300?e.getMessage().substring(0,300):e.getMessage() ) + "</html>"); //$NON-NLS-1$
			} catch (final Exception e) {
				logger.error("Could not generate KML file", e); //$NON-NLS-1$
				e.printStackTrace();
				showMessage("<html>Error generating KML file : <br/> " + e.getMessage()); //$NON-NLS-1$
			} 
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
			new Socket( LocalPropertiesService.LOCAL_HOST , Integer.parseInt(localProperties.getPort())).close(); //$NON-NLS-1$
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
	
	public static void quitServer() {
		try {
			serverController.stopServer();
		} catch (Exception e) {
			logger.error("Error stoping server", e); //$NON-NLS-1$
			e.printStackTrace();
		}
	}
	
	/**
	 * Generates the KML for the project and opens it in Google Earth
	 * @param forceKmlRecreation Set to true if you want to forece the regeneration of the KML even if is is up to date (you might want to do this to force the update of the placemark icons as the date changes)
	 * @throws IOException Throws exception if the KMl file cannot be generated
	 * @throws KmlGenerationException Throws exception if the KML file contents cannot be generated
	 */
	private static void loadKmlInGoogleEarth(boolean forceKmlRecreation) throws IOException, KmlGenerationException {
		earthApp.getKmlGeneratorService().generatePlacemarksKmzFile( forceKmlRecreation );
		earthApp.simulateClickKmz();
	}
	
	public static void restart() {
		try {

			serverController.stopServer();
			startServer(null);

		} catch (final Exception e) {
			logger.error("Error while stopping server", e); //$NON-NLS-1$
			e.printStackTrace();	
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
		final boolean ceAlreadyOpen = isAnotherCollectEarthRunning( getLocalProperties());
		
		if( ceAlreadyOpen ){
			closeSplash();
			// If the user double clicked on a project file while Collect Earth is running then load the project in the running Collect Earth		
			if (doubleClickedProjectFile!=null) {
				openProjectFileInRunningCollectEarth(doubleClickedProjectFile);
			}else{
				showMessage(Messages.getString("EarthApp.11")); //$NON-NLS-1$
			}
		}else{

			startServer(doubleClickedProjectFile);
		}
	}

	public static void startServer(final String doubleClickedProjectFile)
			throws IOException, Exception {
		earthApp = new EarthApp();
		
		// Load the double-clicked CEP file before the survey manager is instantiated by the server start-up
		earthApp.loadProjectIfDoubleClicked(doubleClickedProjectFile);
		

		final Observer observeInitialization = getServerObserver();
		serverStartAndOpenGe(observeInitialization);
	}

	private static Observer getServerObserver() {
		return new Observer() {
			@Override
			public void update(Observable o, Object arg) {
				ServerInitializationEvent initializationEvent = (ServerInitializationEvent) arg;
				if (initializationEvent.equals(ServerInitializationEvent.SERVER_STARTED_NO_DB_CONNECTION_EVENT)) {
					serverController = null;
				}
				
				if( initializationEvent.equals(ServerInitializationEvent.SERVER_STARTED_WITH_DATABASE_CHANGE_EVENT) || 
						initializationEvent.equals(ServerInitializationEvent.SERVER_STARTED_NO_DB_CONNECTION_EVENT)	){
					
					showMessage( initializationEvent.toString());
				}
				
				if (!initializationEvent.equals(ServerInitializationEvent.SERVER_STOPPED_EVENT)) {
					try {				
						earthApp.generateKml();
						earthApp.simulateClickKmz();
						earthApp.checkForUpdates();
						closeSplash();
					} catch (final Exception e) {
						logger.error("Error generating KML file", e); //$NON-NLS-1$
						e.printStackTrace();
					}
				}
			}
		};
	}

	private void openKmlOnGoogleEarth() throws IOException {
		if (Desktop.isDesktopSupported()) {
			Desktop.getDesktop().open(new File(KmlGeneratorService.KML_NETWORK_LINK_STARTER));
		} else {
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
								
				if (updateIniUtils.shouldWarnUser(getLocalProperties() )) {

					javax.swing.SwingUtilities.invokeLater(new Runnable() {
						@Override
						public void run() {

							String remindLater = Messages.getString("EarthApp.3"); //$NON-NLS-1$
							String doItNow = Messages.getString("EarthApp.4"); //$NON-NLS-1$
							String doNotBother = Messages.getString("EarthApp.5"); //$NON-NLS-1$
							
							String newestVersionOnline = updateIniUtils.getVersionAvailableOnline();
							
							Object[] possibleValues = { remindLater, doItNow, doNotBother };
							int chosenOption = JOptionPane.showOptionDialog(null,
									Messages.getString("EarthApp.57"), Messages.getString("EarthApp.58") + Messages.getString("EarthApp.6") + updateIniUtils.convertToDate(newestVersionOnline),  //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
									JOptionPane.DEFAULT_OPTION, JOptionPane.INFORMATION_MESSAGE, null, possibleValues, possibleValues[0]);
							if( chosenOption != JOptionPane.CLOSED_OPTION ){
								if (possibleValues[chosenOption].equals(doItNow)) {
									CheckForUpdatesListener checkForUpdatesListener = new CheckForUpdatesListener();
									checkForUpdatesListener.actionPerformed(null);
								} else if (possibleValues[chosenOption].equals(doNotBother)) {
									getLocalProperties().setValue(EarthProperty.LAST_IGNORED_UPDATE, newestVersionOnline);
								}
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
	private void loadProjectIfDoubleClicked(String doubleClickedProjectFile) {
		try {
			if (doubleClickedProjectFile != null) {

				final File projectFile = new File(doubleClickedProjectFile);

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
		serverController = new ServerController();
		serverController.deleteObservers();
		serverController.startServer(observeInitialization);

	}

	public static void showMessage(String message) {
		try {
			SwingUtilities.invokeAndWait( new Runnable() {
				
				@Override
				public void run() {
					JOptionPane.showMessageDialog(null, message, "Collect Earth", JOptionPane.WARNING_MESSAGE); //$NON-NLS-1$
				}
			});
		} catch (Exception e) {
			logger.error("Error showing message",e);
			e.printStackTrace();
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
	
	public static void executeKmlLoadAsynchronously( Window windowShowingTimer ) {
		new Thread("Load KML in Google Earth"){
			public void run() {
				// Only regenerate KML and reload
				try {
					SwingUtilities.invokeAndWait( new Runnable() {
						@Override
						public void run() {
							if( windowShowingTimer != null ){
								CollectEarthWindow.startWaiting(windowShowingTimer);
							}
						}
					});
					
					EarthApp.loadKmlInGoogleEarth(true);
					
				} catch (Exception e) {
					logger.error("Error loading the KML",e);
					e.printStackTrace();
					EarthApp.showMessage("<html>Problems while generating the KML file: <br/> " + (e.getCause()!=null?(e.getCause()+"<br/>"):"") + ( e.getMessage().length() > 300?e.getMessage().substring(0,300):e.getMessage() ) + "</html>"); //$NON-NLS-1$
				}finally{
					if( windowShowingTimer != null ){
						try {
							SwingUtilities.invokeAndWait( new Runnable() {
								@Override
								public void run() {
									
									CollectEarthWindow.endWaiting(windowShowingTimer);
									if( windowShowingTimer instanceof PropertiesDialog ){
									    ( (PropertiesDialog) windowShowingTimer).closeDialog();
									}
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
