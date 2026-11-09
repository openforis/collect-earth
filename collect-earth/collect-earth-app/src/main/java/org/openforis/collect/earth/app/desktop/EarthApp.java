package org.openforis.collect.earth.app.desktop;

import java.awt.Image;
import java.awt.SplashScreen;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.text.MessageFormat;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.Socket;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLEncoder;
import java.beans.PropertyChangeListener;
import java.nio.charset.StandardCharsets;

import javax.swing.ImageIcon;
import javax.swing.JDialog;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.text.StringEscapeUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.desktop.ServerController.ServerInitializationEvent;
import org.openforis.collect.earth.app.logging.GAlogger;
import org.openforis.collect.earth.app.server.LoadProjectFileServlet;
import org.openforis.collect.earth.app.server.OpenWindowServlet;
import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.FolderFinder;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.SecretProtector;
import org.openforis.collect.earth.app.service.ShellFolderFallback;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.openforis.collect.earth.app.service.notices.Notice;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.service.WindowLayoutService;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.context.WebApplicationContext;

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

	private static final String COLLECT_EARTH_USER_FOLDER_PROPERTY = "collectEarth.userFolder"; //$NON-NLS-1$
	/** What the process that replaces this one writes before it has a log of its own */
	private static final String RELAUNCH_LOG_FILE = "relaunch.log"; //$NON-NLS-1$
	/** A new process that the JVM refuses is gone well within this; a new Collect Earth is still starting */
	private static final int RELAUNCH_GRACE_SECONDS = 5;

	static {
		// This has to happen before the logger below is created, so it cannot wait until main() runs : loading this class already
		// initialises that field, log4j configures itself the first time a logger is used, and log4j2.xml interpolates this
		// property to place earth_error.log. Setting it in main() was too late, the appender received a path with a literal
		// ${sys:collectEarth.userFolder} in it and the error log was never written.
		// The property is used by web.xml as well
		if (System.getProperty(COLLECT_EARTH_USER_FOLDER_PROPERTY) == null) {
			System.setProperty(COLLECT_EARTH_USER_FOLDER_PROPERTY, FolderFinder.getCollectEarthDataFolder());
		}
	}

	private static Logger logger = LoggerFactory.getLogger(EarthApp.class);
	private static ServerController serverController;
	private static EarthApp earthApp;

	static void closeSplash() {
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

			// collectEarth.userFolder is set in the static block above, before the first logger of this class is created

			// The system's look for the Swing that is left (the file chooser of the pages, the messages shown when there is
			// no page): a native-looking file dialog on Windows and macOS
			try {
				UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
			} catch (Exception ex) {
				System.err.println("Failed to initialize LaF");
			}

			// Specify a browser as http.agent so that calls to CloudFlare hosted
			// OpenForis.org do not return with a 403 http error
			System.setProperty("http.agent",
					"Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10.4; en-US; rv:1.9.2.2) Gecko/20100316 Firefox/3.6.2");

			initializeSentry();
			// The cloud token kept by the system, not in plain text (before the first read of the settings): Windows' data
			// protection, the macOS Keychain; on Linux the settings file is made private to its owner. One still in plain
			// text is protected now
			SecretProtector protector = WindowsDpapiProtector.ifAvailable();
			if (protector == null) {
				protector = MacKeychainProtector.ifAvailable();
			}
			LocalPropertiesService.setSecretProtector(protector);
			try {
				getLocalProperties().protectSecrets();
			} catch (RuntimeException e) {
				logger.warn("The cloud token could not be protected", e);
			}
			// After Sentry, whose handler it wraps : a file chooser broken by the Windows shell falls back to plain folders
			ShellFolderFallback.installUncaughtExceptionHandler();

			// Change of font so that Lao and Thao glyphs are supported
			CollectEarthUtils.setFontDependingOnLanguaue(getLocalProperties().getUiLanguage());

			// Something on the screen from the first moment until the main window opens: starting takes from a few
			// seconds to a minute, and a restart (another project, a setting) has closed the old windows meanwhile. In the
			// language of the settings, which the Spring context sets again later (AppShell)
			Messages.setLocale(getLocalProperties().getUiLanguage().getLocale());
			StartupProgressWindow.show(StartupProgressWindow.startTitle());

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
			logger.error("The server could not start", e); //$NON-NLS-1$
			System.exit(1);
		} finally {
			closeSplash();
		}
	}

	private static void initializeSentry() {
		try {
			String releaseName = UpdateIniUtils.getVersionNameInstalled();

			Sentry.init(options -> {
				options.setDsn( "https://24dd6a90c1e4461484712db99c3b3bb7:831e42661c5c4ff3aa5eca270db3f619@sentry.io/299626");
				options.setRelease(releaseName);
				} );
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
			// An exception with no message used to throw here, so the failure of the KML was never reported
			notify(Notice.ERROR, Messages.getString("NoticesPage.server.kml") + "<br/>" //$NON-NLS-1$ //$NON-NLS-2$
					+ (e.getCause() != null ? (StringEscapeUtils.escapeHtml4(String.valueOf(e.getCause())) + "<br/>") : "") //$NON-NLS-1$ //$NON-NLS-2$
					+ StringEscapeUtils.escapeHtml4(StringUtils.abbreviate(StringUtils.defaultString(e.getMessage(), e.toString()), 300)));
		} catch (final Exception e) {
			logger.error("Could not generate KML file", e); //$NON-NLS-1$
			notify(Notice.ERROR, Messages.getString("NoticesPage.server.kml") + "<br/>" + StringEscapeUtils.escapeHtml4(String.valueOf(e.getMessage()))); //$NON-NLS-1$ //$NON-NLS-2$
		}
	}

	/**
	 * What the Swing window showed in a dialog of its own, as a notice of the pages (NoticeService), through the context
	 * that is running; a Swing dialog when there is none yet, as before.
	 */
	public static void notify(String severity, String htmlMessage) {
		notify(severity, "Collect Earth", htmlMessage); //$NON-NLS-1$
	}

	/**
	 * @param htmlMessage the message, as HTML: a text of Messages written for the Swing dialogs may come wrapped in
	 *        html tags, which are taken off
	 */
	public static void notify(String severity, String title, String htmlMessage) {
		String body = htmlMessage.replaceFirst("^\\s*<html>", "").replaceFirst("</html>\\s*$", ""); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		NoticeService notices = null;
		try {
			if (serverController != null && serverController.getContext() != null) {
				notices = serverController.getContext().getBean(NoticeService.class);
			}
		} catch (RuntimeException e) {
			logger.warn("No notice service to show the message with: {}", e.getMessage()); //$NON-NLS-1$
		}
		if (notices != null) {
			notices.post(new Notice("server", severity, title, body).html()); //$NON-NLS-1$
		} else {
			showMessage("<html>" + body + "</html>", title); //$NON-NLS-1$ //$NON-NLS-2$
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
			// Without these the process that is starting waited for ever when the running instance does not answer,
			// with nothing on screen but the splash
			urlConn.setConnectTimeout(5000);
			urlConn.setReadTimeout(5000);

			try (BufferedReader in = new BufferedReader(new InputStreamReader(urlConn.getInputStream()))) {
				String inputLine;
				while ((inputLine = in.readLine()) != null) {
					logger.info(inputLine);
				}
			}

		}
	}

	/** Asks the running Collect Earth to open its window (OpenWindowServlet), as its tray icon would. */
	static void openWindowInRunningCollectEarth() throws IOException {
		String hostAddress = ServerController.getHostAddress(getLocalProperties().getHost(), getLocalProperties().getPort());
		HttpURLConnection connection = (HttpURLConnection) new URL(hostAddress + OpenWindowServlet.SERVLET_NAME).openConnection();
		connection.setConnectTimeout(5000);
		connection.setReadTimeout(5000);
		try {
			int status = connection.getResponseCode();
			if (status != HttpURLConnection.HTTP_ACCEPTED) {
				throw new IOException("The running Collect Earth answered HTTP " + status); //$NON-NLS-1$
			}
		} finally {
			connection.disconnect();
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
		// Not the server starting: the home page is open already, and loading it again would only make it flicker
		earthApp.simulateClickKmz(false);
	}

	/**
	 * Regenerates the KML and opens the plots again, on a thread of its own, after the settings were applied, data
	 * imported or plots deleted. A failure is logged, and so reported to Sentry, and shown on the page as a notice: the
	 * user would otherwise see the old plots and not know why.
	 */
	public static void reloadPlots() {
		new Thread("Reload plots") { //$NON-NLS-1$
			@Override
			public void run() {
				try {
					loadKmlInGoogleEarth(true);
				} catch (Exception e) {
					logger.error("Error reloading the plots", e); //$NON-NLS-1$
					EarthApp.notify(Notice.ERROR, Messages.getString("NoticesPage.server.kml") + "<br/>" //$NON-NLS-1$ //$NON-NLS-2$
							+ StringEscapeUtils.escapeHtml4(StringUtils.abbreviate(StringUtils.defaultString(e.getMessage(), e.toString()), 300)));
				}
			}
		}.start();
	}

	public static void restart() {
		try {
			// The pages close with this process: until the new one opens its window, this one says what goes on
			StartupProgressWindow.show(Messages.getString("StartupWindow.restarting")); //$NON-NLS-1$
			StartupProgressWindow.step(Messages.getString("StartupWindow.saving")); //$NON-NLS-1$
			serverController.stopServer();
			StartupProgressWindow.step(Messages.getString("StartupWindow.relaunching")); //$NON-NLS-1$
			relaunch();

		} catch (final Exception e) {
			logger.error("Error while restarting Collect Earth", e); //$NON-NLS-1$
		}
	}

	/**
	 * Re-creating the embedded Jetty/Spring web context in-process (as {@link #restart()} used
	 * to do by calling {@link #startServer(String)} again) fails: Spring proxies non-interface
	 * DAOs (e.g. {@code CodeListItemDao}) with CGLIB, which cannot redefine the same generated
	 * proxy class a second time in the same classloader and throws a {@link LinkageError} (see
	 * {@code ServerController#isContextReloadFailure}). So instead of reloading in-process,
	 * restarting relaunches Collect Earth as a brand-new JVM process using the same command line
	 * that started this one, then exits this process. Whatever project/property change triggered
	 * the restart has already been persisted to disk by that point, so the new process picks it
	 * up on normal startup exactly as if Collect Earth had just been launched.
	 */
	private static void relaunch() throws IOException {
		final String javaBin = System.getProperty("java.home") + File.separator + "bin" + File.separator //$NON-NLS-1$ //$NON-NLS-2$
				+ (SystemUtils.IS_OS_WINDOWS ? "java.exe" : "java"); //$NON-NLS-1$ //$NON-NLS-2$

		final java.util.List<String> command = new java.util.ArrayList<>();
		command.add(javaBin);
		for (String jvmArg : java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments()) {
			// Debug-agent flags (e.g. added by an IDE launch) must not be propagated: the relaunched
			// process would try to reuse the same JDWP transport socket as this one and fail with
			// "JDWP Transport dt_socket failed to initialize" instead of starting.
			if (!jvmArg.startsWith("-agentlib:jdwp") && !jvmArg.startsWith("-Xrunjdwp") //$NON-NLS-1$ //$NON-NLS-2$
					&& !jvmArg.startsWith("-D" + StartupProgressWindow.RESTARTING_PROPERTY + "=")) { //$NON-NLS-1$ //$NON-NLS-2$
				command.add(jvmArg);
			}
		}
		// The new process says "Restarting" rather than "Starting" in its window while it starts
		command.add("-D" + StartupProgressWindow.RESTARTING_PROPERTY + "=true"); //$NON-NLS-1$ //$NON-NLS-2$

		final String classpath = System.getProperty("java.class.path"); //$NON-NLS-1$
		if (isExecutableJar(classpath)) {
			// Launched with "java -jar CollectEarth.jar": relaunch the same way so the jar's
			// manifest Class-Path entries (the lib/ dependencies) are honored again, which the
			// JVM only does for -jar launches and not for -cp launches.
			command.add("-jar"); //$NON-NLS-1$
			command.add(classpath);
		} else {
			command.add("-cp"); //$NON-NLS-1$
			command.add(classpath);
			command.add(EarthApp.class.getName());
		}

		logger.info("Relaunching Collect Earth: {}", command); //$NON-NLS-1$

		// The output of the new process goes to a file of its own : it used to be inherited, and this process, which is the
		// only thing holding that console, exits a line later, so a new process that refused to start said so to nobody
		final File relaunchLog = new File(FolderFinder.getCollectEarthDataFolder(), RELAUNCH_LOG_FILE);
		final Process relaunched = new ProcessBuilder(command)
				.directory(new File(System.getProperty("user.dir"))) //$NON-NLS-1$
				.redirectErrorStream(true)
				.redirectOutput(relaunchLog)
				.start();

		if (hasEndedAlready(relaunched)) {
			// A command line that the JVM refuses ( a jar with no main class, a class path that is too long for Windows )
			// fails in the first moment. Say so : the window of this process is gone by now, so without this the user is
			// left with no Collect Earth and no reason
			logger.error("Collect Earth could not be restarted, the new process ended with code {} : {}", //$NON-NLS-1$
					relaunched.exitValue(), readRelaunchLog(relaunchLog));
			StartupProgressWindow.close();
			showMessageAndWait(Messages.getString("EarthApp.relaunchFailed"), //$NON-NLS-1$
					Messages.getString("EarthApp.relaunchFailedTitle")); //$NON-NLS-1$
		}

		System.exit(0);
	}

	/**
	 * A class path of a single jar is only worth a -jar launch when that jar can be started : the temporary jar that some
	 * IDEs pass to work around the length limit of the Windows command line holds a Class-Path and no Main-Class, and
	 * "java -jar" of it ends with "no main manifest attribute".
	 */
	private static boolean isExecutableJar(String classpath) {
		if (classpath == null || !classpath.endsWith(".jar") || classpath.contains(File.pathSeparator)) { //$NON-NLS-1$
			return false;
		}
		try (java.util.jar.JarFile jar = new java.util.jar.JarFile(classpath)) {
			return jar.getManifest() != null
					&& jar.getManifest().getMainAttributes().getValue(java.util.jar.Attributes.Name.MAIN_CLASS) != null;
		} catch (IOException e) {
			logger.warn("Could not read the manifest of " + classpath + ", relaunching with the class path instead", e); //$NON-NLS-1$ //$NON-NLS-2$
			return false;
		}
	}

	private static boolean hasEndedAlready(Process relaunched) {
		try {
			return relaunched.waitFor(RELAUNCH_GRACE_SECONDS, TimeUnit.SECONDS);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			return false;
		}
	}

	private static String readRelaunchLog(File relaunchLog) {
		try {
			return new String(Files.readAllBytes(relaunchLog.toPath()), StandardCharsets.UTF_8).trim();
		} catch (IOException e) {
			return "the output of the new process could not be read from " + relaunchLog.getAbsolutePath(); //$NON-NLS-1$
		}
	}

	/**
	 * showMessage posts the dialog and returns, which System.exit would then cut short
	 */
	private static void showMessageAndWait(String message, String title) {
		try {
			SwingUtilities.invokeAndWait(
					() -> JOptionPane.showMessageDialog(null, message, title, JOptionPane.ERROR_MESSAGE));
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		} catch (Exception e) {
			logger.error("Error showing message", e); //$NON-NLS-1$
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
			StartupProgressWindow.close();
			// If the user double clicked on a project file while Collect Earth is running
			// then load the project in the running Collect Earth
			if (doubleClickedProjectFile != null) {
				// isAnotherCollectEarthRunning only proves that something accepted a TCP connection on the port; it
				// cannot tell Collect Earth from any other program, and a dying instance still answers the socket
				// while refusing the request. When the hand-over failed the IOException used to reach main, which
				// logged "The server could not start" and exited with the splash already closed: the interpreter saw
				// nothing at all and the report named the wrong cause. The 503 seen in the field is this case.
				try {
					openProjectFileInRunningCollectEarth(doubleClickedProjectFile);
				} catch (IOException e) {
					final String port = getLocalProperties().getPort();
					logger.warn("Port {} is in use but the project file was not accepted : {}", port, e.getMessage()); //$NON-NLS-1$
					JOptionPane.showMessageDialog(null,
							MessageFormat.format(Messages.getString("EarthApp.74"), port, e.getMessage()), //$NON-NLS-1$
							"Collect Earth", JOptionPane.WARNING_MESSAGE); //$NON-NLS-1$
					System.exit(1);
				}
			} else {
				// Started again: the running Collect Earth opens its window, which is how it is got back on a desktop
				// with no tray icon. Only when it does not answer is the user told it is running
				try {
					openWindowInRunningCollectEarth();
					logger.info("Collect Earth is already running: its window was opened"); //$NON-NLS-1$
					System.exit(0);
				} catch (IOException e) {
					logger.warn("Port in use, but the window of the running Collect Earth could not be opened : {}", e.getMessage()); //$NON-NLS-1$
					JOptionPane.showMessageDialog(null, Messages.getString("EarthApp.11"), "Collect Earth",
							JOptionPane.WARNING_MESSAGE);
					logger.warn("Closing CE - port already in use");
					System.exit(1);
				}
			}
		} else {

			useGoogleEarthWeb();

			startServer(doubleClickedProjectFile);

		}

		GAlogger.logGAnalytics("StartCollectEarth");
	}

	/**
	 * Google Earth Web replaces Google Earth Pro: an installation still set to Google Earth Pro (or set to nothing) is
	 * moved to Google Earth Web at start-up. Runs before the server starts so the viewer is already in earth.properties
	 * when the server-side properties service loads it.
	 */
	private static void useGoogleEarthWeb() {
		final LocalPropertiesService localProperties = getLocalProperties();
		// Unattended runs ( automated tests ) can still choose the viewer with -Dcollectearth.viewerType=...
		String forcedViewerType = System.getProperty("collectearth.viewerType"); //$NON-NLS-1$
		if (StringUtils.isNotBlank(forcedViewerType)) {
			localProperties.saveViewerType(forcedViewerType.trim());
			logger.info("Plot viewer set from the command line : {}", forcedViewerType); //$NON-NLS-1$
			return;
		}
		if (LocalPropertiesService.VIEWER_TYPE_GOOGLE_EARTH_PRO.equals(localProperties.getViewerType())) {
			localProperties.saveViewerType(LocalPropertiesService.VIEWER_TYPE_GOOGLE_EARTH_WEB);
			logger.info("Plot viewer moved from Google Earth Pro to Google Earth Web"); //$NON-NLS-1$
		}
	}

	public static void startServer(final String doubleClickedProjectFile) throws Exception {
		earthApp = new EarthApp();

		// Load the double-clicked CEP file before the survey manager is instantiated by
		// the server start-up
		earthApp.loadProjectIfDoubleClicked(doubleClickedProjectFile);

		final PropertyChangeListener listener = getServerPropertyChangeListener();
		serverStartAndOpenGe(listener);
	}

	private static PropertyChangeListener getServerPropertyChangeListener() {
		return evt -> {
			Object initializationEvent = evt.getNewValue();

			if (initializationEvent.equals(ServerInitializationEvent.SERVER_FAILED_TO_RESTART_EVENT)) {
				handleFatalRestartFailure();
				return;
			}

			if (initializationEvent.equals(ServerInitializationEvent.SERVER_STARTED_NO_DB_CONNECTION_EVENT)) {
				serverController = null;
			}

			if (initializationEvent.equals(ServerInitializationEvent.SERVER_STARTED_WITH_DATABASE_CHANGE_EVENT)) {
				notify(Notice.WARNING, Messages.getString("NoticesPage.server.dbFallback")); //$NON-NLS-1$
			} else if (initializationEvent.equals(ServerInitializationEvent.SERVER_STARTED_NO_DB_CONNECTION_EVENT)) {
				notify(Notice.ERROR, Messages.getString("NoticesPage.server.noDb")); //$NON-NLS-1$
			}

			if (!initializationEvent.equals(ServerInitializationEvent.SERVER_STOPPED_EVENT)) {
				try {
					StartupProgressWindow.step(Messages.getString("StartupWindow.plots")); //$NON-NLS-1$
					earthApp.generateKml();
					StartupProgressWindow.step(Messages.getString("StartupWindow.window")); //$NON-NLS-1$
					// The main window opens on a thread of its own, which closes the progress window (inServerContext)
					earthApp.simulateClickKmz(true);
					// The announcements and the update offer are StartupNotices' now, a bean of the context
					closeSplash();
				} catch (final Exception e) {
					StartupProgressWindow.close();
					logger.error("Error generating KML file", e); //$NON-NLS-1$
				}
			}
		};
	}

	/**
	 * Called when the embedded server could not be restarted (typically because the Spring web context cannot
	 * be reloaded in-process after a project/configuration change). Informs the user and shuts Collect Earth
	 * down in a controlled manner instead of leaving an orphan process running with no window.
	 */
	private static void handleFatalRestartFailure() {
		closeSplash();
		StartupProgressWindow.close();
		logger.error("Collect Earth could not restart after a configuration/project change. Exiting in a controlled manner."); //$NON-NLS-1$
		SwingUtilities.invokeLater(() -> {
			JOptionPane.showMessageDialog(null, Messages.getString("EarthApp.restartFailed"), //$NON-NLS-1$
					Messages.getString("EarthApp.restartFailedTitle"), JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
			System.exit(1);
		});
	}

	private void openKmlOnGoogleEarth() {
		if (!CollectEarthUtils.openFile(new File(KmlGeneratorService.KML_NETWORK_LINK_STARTER))) {
			notify(Notice.ERROR, MessageFormat.format(Messages.getString("EarthApp.kmlCannotOpen"), //$NON-NLS-1$
					StringEscapeUtils.escapeHtml4(new File(KmlGeneratorService.KML_NETWORK_LINK_STARTER).getAbsolutePath())));
		}
	}
	
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

	private static void serverStartAndOpenGe(PropertyChangeListener listener) throws Exception {
		serverController = new ServerController();
		serverController.removeAllPropertyChangeListeners();
		serverController.startServer(listener);

		// Inform Mac OS users of the issues about opening CEP files in the Mac version
		// of CE
		if (SystemUtils.IS_OS_MAC_OSX) {
			notify(Notice.INFO, Messages.getString("EarthApp.73"), "<b>" //$NON-NLS-1$ //$NON-NLS-2$
					+ Messages.getString("EarthApp.70") + "</b>: " //$NON-NLS-2$
					+ Messages.getString("EarthApp.71") + Messages.getString("EarthApp.72") + "<b>" //$NON-NLS-3$
					+ Messages.getString("CollectEarthWindow.10") + " -> " //$NON-NLS-2$
					+ Messages.getString("CollectEarthMenu.0") + "</b>"); //$NON-NLS-2$
		}
	}

	public static void showMessage(String message) {
		showMessage(message, "Collect Earth");

	}

	public static void showMessage(String message, String title) {
		SwingUtilities.invokeLater(() -> {
			try {
				// Build the dialog explicitly (instead of JOptionPane.showMessageDialog) so it can be
				// forced always-on-top and brought to front. Otherwise, at start-up it can be painted
				// behind the always-on-top splash screen / Google Earth window: only its middle shows,
				// the OK button and title bar are covered, and because it is modal the whole application
				// freezes with no way to dismiss it.
				JOptionPane pane = new JOptionPane(message, JOptionPane.WARNING_MESSAGE);
				JDialog dialog = pane.createDialog(null, title);
				dialog.setDefaultCloseOperation(JDialog.DISPOSE_ON_CLOSE);
				dialog.setModal(true);
				dialog.setAlwaysOnTop(true);
				dialog.setLocationRelativeTo(null);
				dialog.toFront();
				dialog.setVisible(true);
				dialog.dispose();
			} catch (Exception e) {
				logger.error("Error showing message", e);
			}
		});
	}

	/**
	 * Opens the plots in the viewer.
	 *
	 * @param serverStarted whether the server has just started (Collect Earth started, or the server restarted for a
	 *                      new project or settings, with a new Spring context and so no window of its own): only then
	 *                      is the home page opened with the Google Earth Pro viewer, not on every reload of the KML
	 */
	private void simulateClickKmz(boolean serverStarted) {
		try {
			if (getLocalProperties().isPlotsMapViewer()) {
				// Plots map / Google Earth Web viewer: no KML handoff to Google Earth Pro;
				// open the plots map served by the embedded server instead.
				openLeafletMap();
			} else {
				getKmlGeneratorService().generateLoaderKmlFile();
				openKmlOnGoogleEarth();
				// The main window of Collect Earth, which the Swing window was: Google Earth Pro shows the plots
				if (serverStarted) {
					openHomePage();
				}
			}
		} catch (final Exception e) {
			StartupProgressWindow.close();
			notify(Notice.ERROR, Messages.getString("EarthApp.61")); //$NON-NLS-1$
			logger.error("The KMZ file could not be found", e); //$NON-NLS-1$
		}
	}

	private void openLeafletMap() {
		inServerContext("the Leaflet plots map", context -> { //$NON-NLS-1$
			context.getBean(BrowserService.class).openLeafletMap();
			// Into its place next to Google Earth Web, also after the options changed the layout
			context.getBean(WindowLayoutService.class).arrange();
		});
	}

	private void openHomePage() {
		inServerContext("the home page", context -> context.getBean(BrowserService.class).openHomePage()); //$NON-NLS-1$
	}

	/**
	 * Opens {@code what} with the beans of the server, on a thread of its own: a browser takes seconds to start, and
	 * this runs on the thread that started the server or loaded the KML. A failure is logged.
	 */
	private void inServerContext(String what, Consumer<WebApplicationContext> opening) {
		new Thread("Open " + what) { //$NON-NLS-1$
			@Override
			public void run() {
				try {
					WebApplicationContext context = serverController == null ? null : serverController.getContext();
					if (context == null) {
						logger.error("Cannot open {}: the server is not initialized", what); //$NON-NLS-1$
						return;
					}
					opening.accept(context);
				} catch (final Exception e) {
					logger.error("Error opening {}", what, e); //$NON-NLS-1$
				} finally {
					// The main window is open (or could not be): the window that said Collect Earth was starting goes
					StartupProgressWindow.close();
				}
			}
		}.start();
	}

}
