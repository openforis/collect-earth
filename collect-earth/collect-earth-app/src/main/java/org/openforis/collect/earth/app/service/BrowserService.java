package org.openforis.collect.earth.app.service;

import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.StringWriter;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.StringJoiner;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.imagery.BidiCommandException;
import org.openforis.collect.earth.app.service.imagery.BidiTabDriver;
import org.openforis.collect.earth.app.service.imagery.ImageryBrowser;
import org.openforis.collect.earth.app.service.imagery.ImageryErrorReporter;
import org.openforis.collect.earth.app.service.imagery.ImagerySource;
import org.openforis.collect.earth.app.service.imagery.ImageryTab;
import org.openforis.collect.earth.app.service.imagery.PageScriptException;
import org.openforis.collect.earth.app.service.imagery.TabClosedException;
import org.openforis.collect.earth.app.service.imagery.TabDriver;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openqa.selenium.By;
import org.openqa.selenium.NoSuchSessionException;
import org.openqa.selenium.NoSuchWindowException;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.edge.EdgeDriver;
import org.openqa.selenium.edge.EdgeOptions;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;
import org.openqa.selenium.firefox.FirefoxProfile;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.openqa.selenium.remote.http.ClientConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.stereotype.Component;

import freemarker.cache.FileTemplateLoader;
import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;
import io.github.bonigarcia.wdm.WebDriverManager;

/**
 * This class contains methods that allow Collect Earth to open browser windows
 * that allow the user to have a better understanding of the plot. So far there
 * are integrations with Google Earth Engine and Earth Map.
 * When a user clicks on a plot Collect Earth will check if the
 * program is set to open any of these integrations, and if it is so it will
 * open each one in its own window. These windows are closed when the program
 * is closed.
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class BrowserService implements InitializingBean, DisposableBean, ApplicationListener<ContextClosedEvent> {

	// Browser type enumeration for thread-safe lock management. The imagery sources need none: ImageryBrowser.loadLatest
	// lets one plot at a time load in each of their tabs.
	private enum BrowserType {
		LEAFLET_MAP
	}

	// Constants for timeouts and wait durations
	private static final int ELEMENT_WAIT_TIMEOUT_SECONDS = 60;
	private static final int WAIT_POLL_INTERVAL_MILLIS = 1000;
	private static final int PLOT_LOAD_SLEEP_MILLIS = 1000;
	/** How long the page of a source may take to load in its tab; a slower site is a warning, not a fault. */
	private static final Duration PAGE_LOAD_TIMEOUT = Duration.ofSeconds(60);
	/** How long the script of a source waits for the map of its page (Wayback, SecureWatch) to be there. */
	private static final Duration MAP_READY_TIMEOUT = Duration.ofSeconds(ELEMENT_WAIT_TIMEOUT_SECONDS);

	// Template paths
	private static final String TEMPLATE_FOR_DGMAP_JS = "resources/javascript_dgmap.fmt";
	private static final String TEMPLATE_FOR_ESRI_WAYBACK_JS = "resources/javascript_esri_wayback.fmt";


	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private GeolocalizeMapService geoLocalizeTemplateService;

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private ImageryErrorReporter imageryErrorReporter;

	/**
	 * Where the imagery sources load, a tab each. It refers to this service in turn (to start its browser): field
	 * injection resolves the cycle, neither bean being proxied.
	 */
	@Autowired
	private ImageryBrowser imageryBrowser;

	/** Lets a plot change fail at once when no browser could start a moment ago; see {@link #startImageryBrowser()}. */
	private final BrowserStartFailures imageryStartFailures = new BrowserStartFailures();

	/** The interpreter is told once per run that the Planet API key is missing, not once per plot */
	private boolean planetApiKeyWarningShown;

	private final CopyOnWriteArrayList<RemoteWebDriver> drivers = new CopyOnWriteArrayList<>();
	private final Logger logger = LoggerFactory.getLogger(BrowserService.class);

	/** The page an app window opens on, before it is sent where it belongs (a load there would be wasted). */
	private static final String BLANK_PAGE = "about:blank";
	private static final String APP_WINDOW_ARGUMENT = "--app=data:text/html,";
	private static final String FIREFOX_APP_PROFILE_FOLDER = "browser_profiles" + File.separator + "firefox_app_window";
	/** Firefox without tabs, address bar or bookmarks: see {@link #initAppWindow(File)}. */
	private static final String FIREFOX_APP_WINDOW_CSS = "#TabsToolbar, #nav-bar, #PersonalToolbar { visibility: collapse !important; }"
			// the minimum width Firefox keeps for its toolbars, which are gone
			+ " :root { min-width: 0 !important; }";
	/** The profile of Chrome and Edge in the imagery window; see {@link #imageryChromiumProfile()}. */
	private static final String IMAGERY_PROFILE_FOLDER = "browser_profiles" + File.separator + "imagery";
	/** What {@link #IMAGERY_PROFILE_FOLDER} was called when it was the profile of the Google Earth Web window. */
	private static final String GOOGLE_EARTH_WEB_PROFILE_FOLDER = "browser_profiles" + File.separator + "google_earth_web";
	private static final String IMAGERY_FIREFOX_PROFILE_FOLDER = "browser_profiles" + File.separator + "imagery_firefox";
	/** Firefox with its tabs, without address bar or bookmarks: see {@link #imageryFirefoxProfile()}. */
	private static final String IMAGERY_FIREFOX_CSS = "#nav-bar, #PersonalToolbar { visibility: collapse !important; }\n";
	private static final String IMAGERY_FIREFOX_USER_JS = "user_pref(\"toolkit.legacyUserProfileCustomizations.stylesheets\", true);\n";
	private final Configuration freemarkerConfig = createFreemarkerConfiguration();

	// Volatile to ensure visibility across threads when modified within synchronized blocks
	private volatile RemoteWebDriver webDriverLeafletMap;

	private final Map<BrowserType, Object> locks = new ConcurrentHashMap<>();

	private volatile boolean geeMethodUpdated = false;
	private volatile boolean isClosing = false;
	private final List<Runnable> leafletMapOpenedListeners = new CopyOnWriteArrayList<>();

	/**
	 * Creates and configures the Freemarker Configuration instance.
	 * Using instance-level configuration for thread safety.
	 *
	 * @return Configured Freemarker Configuration
	 */
	private Configuration createFreemarkerConfiguration() {
		Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
		cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
		try {
			cfg.setTemplateLoader(new FileTemplateLoader(new File(System.getProperty("user.dir"))));
		} catch (IOException e) {
			logger.error("Failed to initialize Freemarker template loader", e);
		}
		return cfg;
	}

	public void closeBrowsers() {
		synchronized (this) {
			getClosingBrowsersThread().start();
		}
	}

	@Override
	public void afterPropertiesSet() throws Exception {
		Runtime.getRuntime().addShutdownHook(getClosingBrowsersThread());
	}

	@Override
	public void destroy() throws Exception {
		closeBrowsers();
	}

	@Override
	public void onApplicationEvent(ContextClosedEvent event) {
		closeBrowsers();
	}

	private RemoteWebDriver chooseDriver() throws BrowserNotFoundException {
		RemoteWebDriver driver = null;
		final String browserSetInProperties = localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim();

		if (browserSetInProperties.equalsIgnoreCase(EarthConstants.CHROME_BROWSER)) {
			driver = tryStartChrome();
		} else if (browserSetInProperties.equalsIgnoreCase(EarthConstants.FIREFOX_BROWSER)) {
			driver = tryStartFirefox();
		} else if (browserSetInProperties.equalsIgnoreCase(EarthConstants.EDGE_BROWSER)) {
			driver = tryStartEdge();
		}

		// If the browser chosen is not installed try to find an installed browser in the computer
		if (driver == null) {
			driver = tryStartChrome();
			if (driver == null) {
				driver = tryStartFirefox();
			}
			if (driver == null) {
				driver = tryStartEdge();
			}
		}

		if (driver == null) {
			throw new BrowserNotFoundException(
					"Neither Chrome, Edge or Firefox could be opened. You need to have one of them installed in order to use GEE, Earth Map or Saiku.");
		}

		return driver;
	}

	private RemoteWebDriver tryStartFirefox() {
		RemoteWebDriver driver = null;
		try {
			driver = (RemoteWebDriver) WebDriverManager.firefoxdriver().create();
		} catch (final Exception e) {
			logger.warn(
					"Problem starting Firefox browser!",
							e);
		}
		return driver;
	}

	private RemoteWebDriver tryStartEdge() {
		RemoteWebDriver driver = null;
		try {
			driver = (RemoteWebDriver) WebDriverManager.edgedriver().create();
		} catch (final Exception e) {
			logger.warn("Problem starting Edge browser", e);
		}
		return driver;
	}

	private RemoteWebDriver tryStartChrome() {
		RemoteWebDriver driver = null;
		try {
			driver = (RemoteWebDriver) WebDriverManager.chromedriver().create();
		} catch (final Exception e) {
			logger.warn(
					"Problem starting Chrome browser",
							e);
		}
		return driver;
	}


	private String getDGMapJavascript(SimplePlacemarkObject placemarkObject) {
		final Map<String, Object> data = geoLocalizeTemplateService.getPlacemarkData(placemarkObject);
		data.put("latitude", placemarkObject.getCoord().getLatitude());
		data.put("longitude", placemarkObject.getCoord().getLongitude());
		return processJavascriptTemplate(data, TEMPLATE_FOR_DGMAP_JS);
	}

	private String getEsriWaybackJavascript(SimplePlacemarkObject placemarkObject) {
		final Map<String, Object> data = geoLocalizeTemplateService.getPlacemarkData(placemarkObject);
		data.put("latitude", placemarkObject.getCoord().getLatitude());
		data.put("longitude", placemarkObject.getCoord().getLongitude());
		return processJavascriptTemplate(data, TEMPLATE_FOR_ESRI_WAYBACK_JS);
	}

	String processJavascriptTemplate(final Map<String, Object> data, String templateName) {
		String result = null;
		try (StringWriter fw = new StringWriter(); BufferedWriter out = new BufferedWriter(fw)) {
			final Template template = freemarkerConfig.getTemplate(templateName);
			template.process(data, out);
			out.flush();
			result = fw.toString();
		} catch (final TemplateException e) {
			logger.error("Error when generating the javascript commands from template: {}", templateName, e);
		} catch (final IOException e) {
			logger.error("Error when reading/writing the template information: {}", templateName, e);
		}
		return result;
	}

	/**
	 * Opens a browser window without tabs, address bar or bookmarks bar (the plots map and Google Earth Web: every pixel
	 * of their height goes to the imagery and the form), on a blank page. Chrome and Edge open it as an app window; with
	 * {@code chromeProfileDir} they keep their profile there, so that cookie consent, Google sign-in and site settings
	 * survive restarts instead of being asked for again in a fresh temporary profile each time. Firefox, which has no app
	 * windows, hides its toolbars with a userChrome.css and keeps the title bar of the system, so the window can still be
	 * moved and closed. The browser chosen in the options is tried first, then the others; a normal window when none of
	 * them can open an app window (e.g. another Collect Earth has the profile open).
	 */
	RemoteWebDriver initAppWindow(File chromeProfileDir) throws BrowserNotFoundException {
		String chosen = localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim();
		RemoteWebDriver driver = null;
		if (chosen.equalsIgnoreCase(EarthConstants.FIREFOX_BROWSER)) {
			driver = tryStartFirefoxAppWindow();
		} else if (chosen.equalsIgnoreCase(EarthConstants.EDGE_BROWSER)) {
			driver = tryStartEdgeAppWindow(chromeProfileDir);
		}
		if (driver == null) {
			driver = tryStartChromeAppWindow(chromeProfileDir);
		}
		if (driver == null) {
			driver = tryStartEdgeAppWindow(chromeProfileDir);
		}
		if (driver == null) {
			driver = tryStartFirefoxAppWindow();
		}
		if (driver == null) {
			return initBrowser();
		}
		if (isClosing) {
			driver.quit();
			return null;
		}
		drivers.add(driver);
		return driver;
	}

	private static List<String> appWindowArguments(File profileDir) {
		List<String> arguments = new ArrayList<>(Arrays.asList(APP_WINDOW_ARGUMENT, "--no-first-run", "--no-default-browser-check"));
		if (profileDir != null) {
			arguments.add("--user-data-dir=" + profileDir.getAbsolutePath());
		}
		return arguments;
	}

	private RemoteWebDriver tryStartChromeAppWindow(File profileDir) {
		try {
			ChromeOptions options = new ChromeOptions();
			options.addArguments(appWindowArguments(profileDir));
			return (RemoteWebDriver) WebDriverManager.chromedriver().capabilities(options).create();
		} catch (final Exception e) {
			logger.warn("Could not open a Chrome app window (profile {})", profileDir, e);
			return null;
		}
	}

	private RemoteWebDriver tryStartEdgeAppWindow(File profileDir) {
		try {
			EdgeOptions options = new EdgeOptions();
			options.addArguments(appWindowArguments(profileDir));
			return (RemoteWebDriver) WebDriverManager.edgedriver().capabilities(options).create();
		} catch (final Exception e) {
			logger.warn("Could not open an Edge app window (profile {})", profileDir, e);
			return null;
		}
	}

	private RemoteWebDriver tryStartFirefoxAppWindow() {
		try {
			// The profile is copied from this folder for every window: only its chrome/userChrome.css matters
			File template = new File(FolderFinder.getCollectEarthDataFolder(), FIREFOX_APP_PROFILE_FOLDER);
			File css = new File(template, "chrome" + File.separator + "userChrome.css");
			if (!css.getParentFile().isDirectory() && !css.getParentFile().mkdirs()) {
				logger.warn("Could not create {}", css.getParentFile());
			}
			Files.write(css.toPath(), FIREFOX_APP_WINDOW_CSS.getBytes(StandardCharsets.UTF_8));
			FirefoxProfile profile = new FirefoxProfile(template);
			profile.setPreference("toolkit.legacyUserProfileCustomizations.stylesheets", true);
			// The system title bar, since the tab strip that holds the window buttons is hidden
			profile.setPreference("browser.tabs.inTitlebar", 0);
			FirefoxOptions options = new FirefoxOptions();
			options.setProfile(profile);
			RemoteWebDriver driver = (RemoteWebDriver) WebDriverManager.firefoxdriver().capabilities(options).create();
			driver.navigate().to(BLANK_PAGE);
			return driver;
		} catch (final Exception e) {
			logger.warn("Could not open a Firefox window without toolbars", e);
			return null;
		}
	}

	/**
	 * Starts the one browser of the imagery window, a tab per source, driven over WebDriver BiDi. The browser chosen in
	 * the options first, then Firefox, Edge and Chrome; a browser that does not start, or not with BiDi, is skipped for
	 * the next one. Each keeps a profile of its own in the Collect Earth data folder, so the sign-ins to Google, Planet
	 * and Earth Engine are kept across sessions; when a browser does not start with it (another Collect Earth has it
	 * open), it is started with a temporary profile, where those are asked for again. Not when it failed for not being
	 * installed ({@link BrowserStartFailures#isNotInstalled}): that would only fail again.
	 * <p>
	 * When no browser starts, the starts asked for during the next {@link BrowserStartFailures#RETRY_AFTER} fail at
	 * once, without a search or a report of their own: each tab asks on every plot.
	 * <p>
	 * The drivers are Selenium's own, not WebDriverManager's {@code create()}, which cannot take the {@link ClientConfig}
	 * that limits how long a BiDi command waits ({@link BidiTabDriver#clientConfig()}). WebDriverManager still finds
	 * the driver executable, as for the other windows: Selenium Manager, which Selenium would use otherwise, downloads
	 * a browser that is not installed, and Firefox would then be downloaded rather than Edge used.
	 * <p>
	 * The browser is quit with the others when Collect Earth closes.
	 *
	 * @throws BrowserNotFoundException when no browser starts with BiDi (reported to Sentry), or none did a moment ago
	 */
	public TabDriver startImageryBrowser() throws BrowserNotFoundException {
		if (imageryStartFailures.failedRecently()) {
			throw new BrowserNotFoundException("No browser could be started for the imagery window less than "
					+ BrowserStartFailures.RETRY_AFTER.getSeconds() + " s ago, not tried again yet");
		}
		for (String browser : imageryBrowserOrder()) {
			RemoteWebDriver driver = startImageryDriver(browser);
			if (driver == null) {
				continue;
			}
			drivers.add(driver); // before the check: either the closing thread quits it, or it is seen closing here
			if (isClosing) {
				drivers.remove(driver);
				quietlyQuit(driver);
				throw new IllegalStateException("Collect Earth is closing, the imagery browser is not needed");
			}
			try {
				TabDriver tabDriver = new BidiTabDriver(driver); // which quits the driver if it fails
				imageryStartFailures.started();
				return tabDriver;
			} catch (RuntimeException e) {
				drivers.remove(driver);
				imageryErrorReporter.report(null, "bidi_setup", e);
			}
		}
		imageryStartFailures.failed();
		BrowserNotFoundException notFound = new BrowserNotFoundException(
				"Neither Firefox, Edge nor Chrome could be started with WebDriver BiDi for the imagery window");
		imageryErrorReporter.report(null, "no_bidi_browser", notFound);
		throw notFound;
	}

	/** The browser chosen in the options, then Firefox, Edge and Chrome, each once. */
	private List<String> imageryBrowserOrder() {
		Set<String> order = new LinkedHashSet<>();
		String chosen = StringUtils.trimToEmpty(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE))
				.toLowerCase(Locale.ROOT);
		if (chosen.equals(EarthConstants.FIREFOX_BROWSER) || chosen.equals(EarthConstants.EDGE_BROWSER)
				|| chosen.equals(EarthConstants.CHROME_BROWSER)) {
			order.add(chosen);
		}
		order.addAll(Arrays.asList(EarthConstants.FIREFOX_BROWSER, EarthConstants.EDGE_BROWSER, EarthConstants.CHROME_BROWSER));
		return new ArrayList<>(order);
	}

	/**
	 * One browser for the imagery window, with its profile, else with a temporary one (see
	 * {@link #startImageryBrowser()}); null when it does not start. Not a fault, the next browser is tried: a warning.
	 */
	private RemoteWebDriver startImageryDriver(String browser) {
		File profile = null;
		try {
			profile = imageryProfile(browser);
		} catch (final IOException e) {
			logger.warn("Could not prepare the profile of {} for the imagery window, a temporary one is used", browser, e);
		}
		try {
			return startImageryDriver(browser, profile);
		} catch (final Exception e) {
			if (profile == null || BrowserStartFailures.isNotInstalled(e)) {
				logger.warn("Could not start {} for the imagery window", browser, e);
				return null;
			}
			// Its profile may be in use by another Collect Earth
			logger.warn("Could not start {} for the imagery window with the profile {}, trying a temporary profile",
					browser, profile, e);
		}
		try {
			return startImageryDriver(browser, null);
		} catch (final Exception e) {
			logger.warn("Could not start {} for the imagery window with a temporary profile", browser, e);
			return null;
		}
	}

	/** The profile folder of the browser in the imagery window, or null for a temporary profile. */
	private File imageryProfile(String browser) throws IOException {
		return EarthConstants.FIREFOX_BROWSER.equals(browser) ? imageryFirefoxProfile() : imageryChromiumProfile();
	}

	/** One browser for the imagery window, with BiDi, using {@code profile}, or a temporary profile when null. */
	private RemoteWebDriver startImageryDriver(String browser, File profile) {
		if (EarthConstants.FIREFOX_BROWSER.equals(browser)) {
			FirefoxOptions options = new FirefoxOptions();
			options.enableBiDi();
			if (profile != null) {
				// Used where it is, not copied to a temporary folder as a FirefoxProfile would be: the sign-ins stay
				options.addArguments("-profile", profile.getAbsolutePath());
			}
			findDriver(WebDriverManager.firefoxdriver());
			return new FirefoxDriver(options, BidiTabDriver.clientConfig());
		}
		List<String> arguments = new ArrayList<>(Arrays.asList("--no-first-run", "--no-default-browser-check"));
		if (profile != null) {
			arguments.add("--user-data-dir=" + profile.getAbsolutePath());
		}
		// A normal window, not an --app one, which has no tabs
		if (EarthConstants.EDGE_BROWSER.equals(browser)) {
			EdgeOptions options = new EdgeOptions();
			options.enableBiDi();
			options.addArguments(arguments);
			findDriver(WebDriverManager.edgedriver());
			return new EdgeDriver(options, BidiTabDriver.clientConfig());
		}
		ChromeOptions options = new ChromeOptions();
		options.enableBiDi();
		options.addArguments(arguments);
		findDriver(WebDriverManager.chromedriver());
		return new ChromeDriver(options, BidiTabDriver.clientConfig());
	}

	/**
	 * Finds the driver executable and sets it in the system property Selenium reads, so that Selenium Manager is not
	 * used: see {@link #startImageryBrowser()}. When it cannot be found (offline, first run), Selenium Manager tries.
	 */
	private void findDriver(WebDriverManager manager) {
		try {
			manager.setup();
		} catch (RuntimeException e) {
			logger.warn("WebDriverManager could not find the driver, Selenium Manager will try: {}", e.getMessage());
		}
	}

	/**
	 * The Firefox profile of the imagery window: the tab strip stays, it is how the sources are switched; the address
	 * and bookmarks bars go. Firefox reads userChrome.css only when user.js allows it.
	 */
	private File imageryFirefoxProfile() throws IOException {
		File folder = new File(FolderFinder.getCollectEarthDataFolder(), IMAGERY_FIREFOX_PROFILE_FOLDER);
		File chrome = new File(folder, "chrome");
		Files.createDirectories(chrome.toPath());
		Files.write(new File(chrome, "userChrome.css").toPath(), IMAGERY_FIREFOX_CSS.getBytes(StandardCharsets.UTF_8));
		Files.write(new File(folder, "user.js").toPath(), IMAGERY_FIREFOX_USER_JS.getBytes(StandardCharsets.UTF_8));
		return folder;
	}

	/**
	 * The Chrome and Edge profile of the imagery window. It used to be the one of the Google Earth Web window: that
	 * folder is taken over the first time, so the Google sign-in in it is kept.
	 * <p>
	 * When the old folder cannot be renamed (a browser has it open, another Collect Earth mostly), null: a temporary
	 * profile for this run. Not a new, empty folder under the new name, which would stop the rename from being tried
	 * again and leave the sign-in behind for good; the next start tries again.
	 */
	private File imageryChromiumProfile() throws IOException {
		File folder = new File(FolderFinder.getCollectEarthDataFolder(), IMAGERY_PROFILE_FOLDER);
		File googleEarthWeb = new File(FolderFinder.getCollectEarthDataFolder(), GOOGLE_EARTH_WEB_PROFILE_FOLDER);
		if (!folder.exists() && googleEarthWeb.isDirectory()) {
			if (!googleEarthWeb.renameTo(folder)) {
				logger.warn("Could not rename {} to {} (in use?), a temporary profile is used until it can be",
						googleEarthWeb, folder);
				return null;
			}
			logger.info("The profile of the Google Earth Web window is now the one of the imagery window: {}", folder);
		}
		Files.createDirectories(folder.toPath());
		return folder;
	}

	private void quietlyQuit(RemoteWebDriver driver) {
		try {
			driver.quit();
		} catch (final Exception e) {
			logger.warn("A browser could not be quit, it had probably been closed already : {}", e.getMessage());
		}
	}

	private RemoteWebDriver initBrowser() throws BrowserNotFoundException {
		RemoteWebDriver driver = null;
		driver = chooseDriver();
		if (isClosing) { // In case the browser takes so long to start that the user closes CE and this
			// method is called when the other windows are being closed
			driver.quit();
			driver = null;
		} else {
			drivers.add(driver);
		}
		return driver;
	}

	/**
	 * Checks if an element is present and displayed by ID or name.
	 *
	 * @param elementId The ID or name of the element to find
	 * @param driver The WebDriver instance
	 * @return true if element is found and displayed, false otherwise
	 */
	public static boolean isElementPresentByIdOrName(String elementId, RemoteWebDriver driver) {
		try {
			// findElement throws when there is no such element, so the lookup by name was never reached for a page whose
			// field carries a name and no id, and every wait for it ran to its full timeout
			return isAnyDisplayed(driver.findElements(By.id(elementId)))
					|| isAnyDisplayed(driver.findElements(By.name(elementId)));
		} catch (final Exception e) {
			// Element not found - this is expected behavior, not an error
			return false;
		}
	}

	private static boolean isAnyDisplayed(List<WebElement> elements) {
		for (WebElement element : elements) {
			if (element.isDisplayed()) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Draws the plot over the SecureWatch map of the tab, once the map is there, and unlocks the view if it is locked.
	 * Everything in the page's own scripts: a classic WebDriver click would select the tab.
	 */
	private void loadPlotInDGMap(SimplePlacemarkObject placemarkObject, ImageryTab tab) {
		if (!tab.waitUntil(
				"return !!(document.getElementById('mainContent') || document.getElementsByName('mainContent').length);",
				MAP_READY_TIMEOUT)) {
			logger.warn("{}: the map did not appear in time, the plot is not drawn", tab.source());
			return;
		}
		String dgmapJs = getDGMapJavascript(placemarkObject);
		if (dgmapJs == null) {
			return; // logged where the template failed
		}
		tab.evaluate(dgmapJs);
		try {
			Thread.sleep(PLOT_LOAD_SLEEP_MILLIS);
		} catch (final InterruptedException e) {
			Thread.currentThread().interrupt();
			return;
		}
		tab.evaluate("var l = document.querySelector('.lock.on'); if (l) { l.click(); }");
	}

	/**
	 * Injects the plot polygon overlay and an auto cookie-consent click into
	 * ESRI Living Atlas Wayback. The Wayback app is a React SPA built on the
	 * ArcGIS Maps SDK for JavaScript; the injected script locates the MapView
	 * (the view of its arcgis-map element) and draws the plot over it. It waits
	 * for the MapView by itself, so it is injected as soon as the page has loaded.
	 * <p>
	 * Not after waiting here for the map: that wait was for a {@code .esri-view}
	 * element that the Wayback app no longer has, so it took its full minute on
	 * every plot and held up the next plot of the tab as long ({@link #loadInTab}
	 * loads the latest plot only once the one before is done).
	 */
	private void loadPlotInEsriWayback(SimplePlacemarkObject placemarkObject, ImageryTab tab) {
		String waybackJs = getEsriWaybackJavascript(placemarkObject);
		if (waybackJs != null) {
			tab.evaluate(waybackJs);
		}
	}

	/** What is done in the tab of a source once its page has loaded. */
	@FunctionalInterface
	private interface AfterLoad {
		void run(ImageryTab tab);
	}

	/** Loads the URL in the tab of the source, the latest plot only; see {@link #loadInTab(ImagerySource, long, String, AfterLoad)}. */
	private void loadInTab(ImagerySource source, long selection, String url) {
		loadInTab(source, selection, url, null);
	}

	/**
	 * Loads the URL in the tab of the source, then runs {@code afterLoad} there, if any. Through
	 * {@link ImageryBrowser#loadLatest}: when plots come faster than the source loads them, the ones in between are
	 * skipped. The load is forced ({@code reload}) as {@link #navigateTo} did: Wayback and the Earth Engine app change
	 * only the #fragment of their URL from plot to plot, which a navigation alone does not load again.
	 * <p>
	 * The load may run on the thread of another plot, so it handles its own errors. None of them is logged at ERROR,
	 * which would open the error dialog on every plot: a slow site, a closed tab and a missing browser are not faults of
	 * Collect Earth, and the faults (a script of ours that throws, a BiDi command that fails, a browser that hangs) are
	 * reported to Sentry by {@link ImageryBrowser} already. Only an unexpected failure here is an error.
	 */
	private void loadInTab(ImagerySource source, long selection, String url, AfterLoad afterLoad) {
		if (url == null) {
			return; // logged where the URL failed
		}
		imageryBrowser.loadLatest(source, selection, () -> {
			try {
				try {
					loadOnce(source, url, afterLoad);
				} catch (final TabClosedException e) {
					// The user closed the tab while it loaded, or closed the whole window since the last plot, which
					// the browser tells at the first command only: once more, in a tab (or a browser) opened anew, as
					// GoogleEarthWebService does. Without it the source would miss this plot until the next one.
					logger.warn("{}: {}; opening it again", source, e.getMessage());
					loadOnce(source, url, afterLoad);
				}
			} catch (final TabClosedException e) {
				logger.warn("{}: the tab was closed while the plot loaded", source);
			} catch (final PageScriptException | BidiCommandException e) {
				logger.warn("{}: the plot could not be shown: {}", source, e.getMessage()); // reported by ImageryBrowser
			} catch (final RuntimeException e) {
				if (isCausedBy(e, BrowserNotFoundException.class)) {
					logger.warn("{}: no browser for the imagery window: {}", source, e.getMessage());
				} else if (e instanceof IllegalStateException) {
					// The browser was busy, hung, slow to start or shut down: reported by ImageryBrowser when a fault
					logger.warn("{}: the plot could not be shown: {}", source, e.getMessage());
				} else {
					logger.error("Problems loading {}", source, e);
				}
			}
		});
	}

	private void loadOnce(ImagerySource source, String url, AfterLoad afterLoad) {
		ImageryTab tab = imageryBrowser.tab(source);
		if (!tab.load(url, true, PAGE_LOAD_TIMEOUT)) {
			// A slow site is not a fault; the script after the load waits for its map by itself
			logger.warn("{} did not load in time", source);
		}
		if (afterLoad != null) {
			afterLoad.run(tab);
		}
	}

	static boolean isCausedBy(Throwable failure, Class<? extends Throwable> type) {
		for (Throwable t = failure; t != null; t = t.getCause()) {
			if (type.isInstance(t)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * The imagery sources switched on, in the order of their tabs: Google Earth Web when it is the viewer, and each
	 * source whose {@code openX} method below would load the plot (the same checks).
	 */
	public Set<ImagerySource> enabledImagerySources() {
		Set<ImagerySource> sources = EnumSet.noneOf(ImagerySource.class);
		if (localPropertiesService.isGoogleEarthWebViewer()) {
			sources.add(ImagerySource.GOOGLE_EARTH_WEB);
		}
		if (localPropertiesService.isEsriWaybackSupported()) {
			sources.add(ImagerySource.ESRI_WAYBACK);
		}
		if (localPropertiesService.isPlanetMapsSupported() && StringUtils.isNotBlank(localPropertiesService.getPlanetMapsKey())) {
			sources.add(ImagerySource.PLANET);
		}
		if (localPropertiesService.isGEEAppSupported()) {
			sources.add(ImagerySource.GEE_APP);
		}
		if (localPropertiesService.isEarthMapSupported()) {
			sources.add(ImagerySource.EARTH_MAP);
		}
		if (localPropertiesService.isStreetViewSupported()) {
			sources.add(ImagerySource.STREET_VIEW);
		}
		if (StringUtils.isNotBlank(localPropertiesService.getExtraMap())) {
			sources.add(ImagerySource.EXTRA_MAP);
		}
		if (localPropertiesService.isSecureWatchSupported()) {
			sources.add(ImagerySource.SECURE_WATCH);
		}
		return sources;
	}

	public boolean isGeeMethodUpdated() {
		return geeMethodUpdated;
	}

	public void setGeeMethodUpdated(boolean geeMethodUpdated) {
		this.geeMethodUpdated = geeMethodUpdated;
	}

	public RemoteWebDriver navigateTo(String url, RemoteWebDriver driver) throws BrowserNotFoundException {
		return navigateTo(url, driver, true);
	}

	/**
	 * Loads the given URL into the browser. If the browser is null then a new
	 * browser window is open.
	 *
	 * @param url
	 *            The URL to load.
	 * @param driverParam
	 *            The browser window to use. If this value is null a new browser
	 *            window is open.
	 * @param retry
	 *            Specify if there should be a second try to open a browser window
	 *            if the first time fails (useful if the browser could not be found)
	 * @return The browser window (firefox or chrome depending on the configuration)
	 *         used to open the URL.
	 * @throws BrowserNotFoundException
	 *             Exception thrown when there is no Firefox/Chrome installed
	 */
	public RemoteWebDriver navigateTo(String url, RemoteWebDriver driverParam, boolean retry)
			throws BrowserNotFoundException {
		return navigateTo(url, driverParam, retry, true);
	}

	/**
	 * As {@link #navigateTo(String, RemoteWebDriver, boolean)}; {@code refresh} forces a reload
	 * after navigating, needed by pages whose URL only changes in the #fragment. Pages whose
	 * path changes (Google Earth Web) already load on navigation and must not pay that twice.
	 */
	RemoteWebDriver navigateTo(String url, RemoteWebDriver driverParam, boolean retry, boolean refresh)
			throws BrowserNotFoundException {

		RemoteWebDriver driver = driverParam;

		if (driver == null || !isDriverWorking(driver)) {
			driver = initBrowser();
		}

		if (driver != null) {
			try {
				driver.navigate().to(url);
				// Refresh to make sure it loads the new plot
				if (refresh) {
					try {
						driver.navigate().refresh(); // FORCE REFRESH - OTHERWISE WINDOW IS NOT REFRESHED
					} catch (final Exception e) {
						if (windowWasClosed(e)) {
							logger.warn("The browser window was closed before it could be refreshed");
						} else {
							logger.error("Error refreshing the browser window", e);
						}
					}
				}
			} catch (final Exception e) {
				if (retry && windowWasClosed(e)) {
					// The interpreter closed the window. Opening another one is the normal answer to that, not a
					// failure, and it was logged at ERROR - the level the Sentry appender is bound at - so closing a
					// window was reported as a fault in Collect Earth.
					logger.warn("The browser window was closed, opening a new one");
					driver = initBrowser();
					// Keep what the retry returns : the driver of the window that was just opened
					driver = navigateTo(url, driver, false, refresh); // only try to re-open one
				} else if (windowWasClosed(e)) {
					logger.warn("The browser window was closed while {} was loading", url);
				} else if (timedOut(e)) {
					// A slow connection, not a defect : Earth Engine apps in particular can take minutes to load
					logger.warn("The page {} did not load in time : {}", url, e.getMessage());
				} else {
					// Every other failure used to be swallowed here, so a page that does not load left no trace at all
					logger.error("Error loading the page in the browser", e);
				}
			}
		} else {
			logger.error("No Selenium driver available, Is Firefox or Chrome installed?");
		}
		return driver;
	}

	/**
	 * Did this failure happen because the browser window is gone? The interpreter closing the Google Earth window
	 * mid-operation is ordinary use, so it is reported as a warning rather than an error. Selenium says so with a
	 * typed exception, but wraps it often enough that the whole cause chain and the message are both worth checking.
	 */
	private boolean timedOut(Throwable failure) {
		for (Throwable t = failure; t != null; t = t.getCause()) {
			if (t instanceof org.openqa.selenium.TimeoutException || t instanceof java.util.concurrent.TimeoutException) {
				return true;
			}
		}
		return false;
	}

	private boolean windowWasClosed(Throwable failure) {
		for (Throwable t = failure; t != null; t = t.getCause()) {
			if (t instanceof NoSuchWindowException || t instanceof NoSuchSessionException) {
				return true;
			}
			final String message = t.getMessage();
			if (message != null && (message.contains("Session not found") //$NON-NLS-1$
					|| message.contains("target window already closed") //$NON-NLS-1$
					|| message.contains("no such window"))) { //$NON-NLS-1$
				return true;
			}
		}
		return false;
	}

	protected boolean isDriverWorking(RemoteWebDriver driver) {
		boolean stillWorking = true;
		try {
			driver.findElement(By.xpath("//body"));
		} catch (Exception e) {
			stillWorking = false;
		}
		return stillWorking;
	}


	/**
	 * Gets or creates a lock object for the specified browser type.
	 * Thread-safe using ConcurrentHashMap.
	 *
	 * @param type The browser type
	 * @return A lock object for synchronization
	 */
	private Object getOrCreateLock(BrowserType type) {
		return locks.computeIfAbsent(type, k -> new Object());
	}

	/**
	 * Shows the Planet Basemaps representation of the plot in the Planet tab of the imagery window.
	 * Supports two modes:
	 * - TFO mode: Opens the hosted planet.html page with NICFI monthly basemaps
	 * - Daily mode: Uses local Freemarker template with Planet Daily API
	 *
	 * @param placemarkObject The data of the plot.
	 * @param selection       the number of the plot selection, see {@link ImageryBrowser#loadLatest}
	 */
	public void openPlanetMaps(SimplePlacemarkObject placemarkObject, long selection) {
		if (localPropertiesService.isPlanetMapsSupported()) {
			// both modes are opened with the same key, and neither of them shows anything without it
			if (StringUtils.isBlank(localPropertiesService.getPlanetMapsKey())) {
				warnAboutMissingPlanetApiKey();
				return;
			}
			try {
				if (localPropertiesService.isPlanetMapsUseTfo()) {
					// TFO mode: Use hosted planet.html with NICFI monthly basemaps
					openPlanetTfoMode(placemarkObject, selection);
				} else {
					// Daily mode: Use local Freemarker template with Planet Daily API
					openPlanetDailyMode(placemarkObject, selection);
				}
			} catch (final Exception e) {
				logger.error("Problems loading Planet", e);
			}
		}
	}

	/**
	 * Planet is opened for every plot, so the interpreter is told once per run: a dialog on each plot would
	 * get in the way of the assessment, and the key is entered in the options dialog, not here.
	 */
	private void warnAboutMissingPlanetApiKey() {
		logger.warn("Planet is switched on but no Planet API key is configured");
		if (!planetApiKeyWarningShown) {
			planetApiKeyWarningShown = true;
			EarthApp.showMessage(Messages.getString("BrowserService.planetApiKeyMissing"), //$NON-NLS-1$
					Messages.getString("BrowserService.planetApiKeyMissingTitle")); //$NON-NLS-1$
		}
	}

	/**
	 * Opens Planet imagery using the Tropical Forest Observatory (TFO) monthly basemaps.
	 * Opens the hosted planet.html page at openforis.org with URL parameters.
	 * Uses the same API key as Daily mode (PLANET_MAPS_KEY).
	 */
	private void openPlanetTfoMode(SimplePlacemarkObject placemarkObject, long selection) {
		// openPlanetMaps has already checked that there is a key
		String apiKey = localPropertiesService.getValue(EarthProperty.PLANET_MAPS_KEY);

		try {
			StringBuilder url = new StringBuilder("https://openforis.org/fileadmin/planet.html?");

			// Add latlngs parameter (polygon coordinates)
			String latlngs = getLatLngsForPlanetHtml(placemarkObject);
			url.append("latlngs=").append(URLEncoder.encode(latlngs, StandardCharsets.UTF_8.toString()));

			// Add API key
			url.append("&planet_api_key=").append(URLEncoder.encode(apiKey, StandardCharsets.UTF_8.toString()));

			// Add optional date parameters. The "first / latest available" choices of the options dialog are saved as
			// empty values; properties written by older versions hold the words "Oldest" / "Latest" for the same thing
			String dateFrom = localPropertiesService.getPlanetTfoDateFrom();
			if (StringUtils.isNotBlank(dateFrom) && !"Oldest".equals(dateFrom)) {
				url.append("&planet_date_from=").append(URLEncoder.encode(dateFrom, StandardCharsets.UTF_8.toString()));
			}

			String dateTo = localPropertiesService.getPlanetTfoDateTo();
			if (StringUtils.isNotBlank(dateTo) && !"Latest".equals(dateTo)) {
				url.append("&planet_date_to=").append(URLEncoder.encode(dateTo, StandardCharsets.UTF_8.toString()));
			}

			loadInTab(ImagerySource.PLANET, selection, url.toString());

		} catch (final Exception e) {
			logger.error("Problems loading Planet TFO mode", e);
		}
	}

	/**
	 * Opens Planet imagery using the Daily API via local Freemarker template.
	 */
	private void openPlanetDailyMode(SimplePlacemarkObject placemarkObject, long selection) {
		String template = GeolocalizeMapService.FREEMARKER_PLANET_DAILY_HTML_TEMPLATE;
		String key = localPropertiesService.getValue(EarthProperty.PLANET_MAPS_KEY);

		try {
			String processTemplate = geoLocalizeTemplateService.getUrlToFreemarkerOutput(
					placemarkObject,
					template,
					"planetMapsKey",
					key,
					"urlPlanetEndpointPrefix",
					ServerController.getHostAddress(localPropertiesService.getHost(), localPropertiesService.getPort())
			).toString();

			loadInTab(ImagerySource.PLANET, selection, processTemplate);

		} catch (final Exception e) {
			logger.error("Problems loading Planet Daily mode", e);
		}
	}

	/**
	 * Generates the latlngs JSON array parameter for the planet.html page.
	 * Format: [[[lat,lng],[lat,lng],...],[[lat,lng],...]]
	 */
	private String getLatLngsForPlanetHtml(SimplePlacemarkObject placemarkObject) {
		StringBuilder latlngs = new StringBuilder("[");

		// Add outer shape
		List<SimpleCoordinate> shape = placemarkObject.getShape();
		if (shape != null && !shape.isEmpty()) {
			latlngs.append("[");
			StringJoiner joiner = new StringJoiner(",");
			for (SimpleCoordinate coord : shape) {
				joiner.add("[" + coord.getLatitude() + "," + coord.getLongitude() + "]");
			}
			latlngs.append(joiner.toString());
			latlngs.append("]");
		}

		latlngs.append("]");
		return latlngs.toString();
	}

	/**
	 * Shows the plot in SecureWatch, in its tab of the imagery window.
	 *
	 * @param placemarkObject The data of the plot.
	 * @param selection       the number of the plot selection, see {@link ImageryBrowser#loadLatest}
	 */
	public void openSecureWatch(SimplePlacemarkObject placemarkObject, long selection) {
		if ( localPropertiesService.isSecureWatchSupported() ) {
			String url = getUrlBaseIntegration(placemarkObject, localPropertiesService.getSecureWatchURL() + "/#18/LATITUDE/LONGITUDE" );
			logger.info("Loading layers - {}", placemarkObject);
			loadInTab(ImagerySource.SECURE_WATCH, selection, url, tab -> loadPlotInDGMap(placemarkObject, tab));
		}
	}

	/**
	 * Shows the plot in the extra map of the options, in its tab of the imagery window.
	 *
	 * @param placemarkObject The data of the plot.
	 * @param selection       the number of the plot selection, see {@link ImageryBrowser#loadLatest}
	 */
	public void openExtraMap(SimplePlacemarkObject placemarkObject, long selection) {
		if (!StringUtils.isBlank(localPropertiesService.getExtraMap())) {
			loadInTab(ImagerySource.EXTRA_MAP, selection, getUrlBaseIntegration(placemarkObject, localPropertiesService.getExtraMap()));
		}
	}

	/**
	 * Creates a URL by replacing placeholders with actual placemark data.
	 * Supports LATITUDE, LONGITUDE, GEOJSON, and PLOT_ID placeholders.
	 *
	 * @param placemarkObject The placemark containing the data
	 * @param url The URL template with placeholders
	 * @return The URL with placeholders replaced, or null if an error occurs
	 */
	private String getUrlBaseIntegration(SimplePlacemarkObject placemarkObject, String url) {
		try {
			String latitude = placemarkObject.getCoord().getLatitude();
			String longitude = placemarkObject.getCoord().getLongitude();
			// For cases where ID also has round, the id string would be "plotId,round", we only want the ID
			String id = placemarkObject.getPlacemarkId().split(",")[0];

			// URLEncoder.encode with UTF-8 never throws UnsupportedEncodingException
			String geojson = URLEncoder.encode(getGeoJson(placemarkObject, "MultiLineString"), StandardCharsets.UTF_8.toString());

			return url.replace("LATITUDE", latitude)
					.replace("LONGITUDE", longitude)
					.replace("GEOJSON", geojson)
					.replace("PLOT_ID", id);

		} catch (final Exception e) {
			logger.error("Error constructing URL from template: {}", url, e);
			return null;
		}
	}

	/**
	 * Shows the Google Street View representation of the plot, in its tab of the imagery window.
	 *
	 * @param placemarkObject The data of the plot.
	 * @param selection       the number of the plot selection, see {@link ImageryBrowser#loadLatest}
	 */
	public void openStreetView(SimplePlacemarkObject placemarkObject, long selection) {
		if (localPropertiesService.isStreetViewSupported()) {
			try {
				loadInTab(ImagerySource.STREET_VIEW, selection,
						geoLocalizeTemplateService.getUrlToFreemarkerOutput(placemarkObject,
								GeolocalizeMapService.FREEMARKER_STREET_VIEW_HTML_TEMPLATE, "googleMapsApiKey",
								localPropertiesService.getValue(EarthProperty.GOOGLE_MAPS_API_KEY)).toString());
			} catch (final Exception e) {
				logger.error("Problems loading Street View", e);
			}
		}
	}

	private StringBuilder getGeoJsonSegment(List<SimpleCoordinate> coordinates) {
		StringBuilder geoJson = new StringBuilder("[");
		if (coordinates != null && !coordinates.isEmpty()) {
			StringJoiner joiner = new StringJoiner(",");
			for (SimpleCoordinate coord : coordinates) {
				joiner.add("[" + coord.getLongitude() + "," + coord.getLatitude() + "]");
			}
			geoJson.append(joiner.toString());
		}
		geoJson.append("],");
		return geoJson;
	}




	private String getFeature(SimplePlacemarkObject placemarkObject, String shapeType, String name ) {
		StringBuilder feature = new StringBuilder("{\"type\":\"Feature\",\"properties\":{\"name\":\"");
		feature.append(name).append("\"},\"geometry\":");
		feature.append(getGeoJson(placemarkObject, shapeType)).append("}");
		return feature.toString();
	}

	private String getGeoJson(SimplePlacemarkObject placemarkObject, String shapeType ) {
		StringBuilder geoJson = new StringBuilder("{\"type\":\"");
		geoJson.append(shapeType).append("\",\"coordinates\":[");
		List<SimpleCoordinate> shape = placemarkObject.getShape();
		StringBuilder segment = getGeoJsonSegment(shape);
		// Remove the trailing comma from the segment
		if (segment.length() > 0 && segment.charAt(segment.length() - 1) == ',') {
			segment.deleteCharAt(segment.length() - 1);
		}
		geoJson.append(segment).append("]}");
		return geoJson.toString();
	}

	/**
	 * Shows the plot in the Google Earth Engine App, in its tab of the imagery window.
	 *
	 * @param placemarkObject The center point of the plot.
	 * @param selection       the number of the plot selection, see {@link ImageryBrowser#loadLatest}
	 */
	public void openGEEAppURL(SimplePlacemarkObject placemarkObject, long selection) {
		if (localPropertiesService.isGEEAppSupported()) {

			try {
				StringBuilder url = new StringBuilder(localPropertiesService.getGEEAppURL());
				url = url.append("#geoJson=")
						.append(URLEncoder.encode(getGeoJson(placemarkObject, "MultiLineString"), StandardCharsets.UTF_8.toString()))
						.append(";");
				// placemarkId is null when the plot was built from coordinates only
				// (e.g. legacy /openAuxiliaryWindows callers without a plotId param)
				String plotId = placemarkObject.getPlacemarkId() == null ? "" : placemarkObject.getPlacemarkId();
				url = url.append("plotId=")
						.append(URLEncoder.encode(plotId, StandardCharsets.UTF_8.toString()))
						.append(";");
				url = url.append("survey=")
						.append(URLEncoder.encode( earthSurveyService.getCollectSurvey().getName() , StandardCharsets.UTF_8.toString()))
						.append(";");

				if( StringUtils.isNotBlank( localPropertiesService.getValue( EarthProperty.GEEAPP_FROM_DATE) ) ) {
					url = url.append("startTime=")
							.append( localPropertiesService.getValue( EarthProperty.GEEAPP_FROM_DATE) )
							.append(";");
				}
				if( StringUtils.isNotBlank( localPropertiesService.getValue( EarthProperty.GEEAPP_TO_DATE) ) ) {
					url = url.append("endTime=")
							.append( localPropertiesService.getValue( EarthProperty.GEEAPP_TO_DATE) )
							.append(";");
				}

				loadInTab(ImagerySource.GEE_APP, selection, url.toString());
			} catch (final Exception e) {
				logger.error("Problems loading GEE APP window", e);
			}
		}
	}


	/**
	 * Shows the plot in Earth Map, in its tab of the imagery window.
	 *
	 * @param placemarkObject The placemark data
	 * @param selection       the number of the plot selection, see {@link ImageryBrowser#loadLatest}
	 */
	public void openEarthMapURL(SimplePlacemarkObject placemarkObject, long selection) {
		if (localPropertiesService.isEarthMapSupported()) {

			try {
				StringBuilder url = new StringBuilder(localPropertiesService.getEarthMapURL()).append("?");
				url = url.append("polygon=")
						.append(URLEncoder.encode(getFeature(placemarkObject, "Polygon", placemarkObject.getPlacemarkId()), StandardCharsets.UTF_8.toString()))
						.append("&");

				if( StringUtils.isNotBlank(localPropertiesService.getEarthMapLayers()) ) {
					url = url.append("layers=")
							.append(URLEncoder.encode(localPropertiesService.getEarthMapLayers(), StandardCharsets.UTF_8.toString()))
							.append("&");
				}

				if( StringUtils.isNotBlank(localPropertiesService.getEarthMapScripts()) ) {
					url = url.append("scripts=")
							.append(URLEncoder.encode(localPropertiesService.getEarthMapScripts(), StandardCharsets.UTF_8.toString()))
							.append("&");
				}

				String aoi = localPropertiesService.getEarthMapAOI();
				if( StringUtils.isBlank(aoi) ) {
					aoi = "global";
				}
				url = url.append("aoi=")
						.append(URLEncoder.encode( aoi, StandardCharsets.UTF_8.toString() ))
						.append("&embed=true"); // Set the EMBED parameter to true so that the user does not need to log in.

				loadInTab(ImagerySource.EARTH_MAP, selection, url.toString());
			} catch (final Exception e) {
				logger.error("Problems loading Earth Map window", e);
			}
		}
	}

	/**
	 * Shows ESRI World Imagery Wayback centered on the plot, with the plot drawn over it, in its tab of the imagery
	 * window.
	 *
	 * @param placemarkObject The center point of the plot.
	 * @param selection       the number of the plot selection, see {@link ImageryBrowser#loadLatest}
	 */
	public void openEsriWayback(SimplePlacemarkObject placemarkObject, long selection) {
		if (localPropertiesService.isEsriWaybackSupported()) {
			try {
				String longitude = placemarkObject.getCoord().getLongitude();
				String latitude = placemarkObject.getCoord().getLatitude();
				// URL format: https://livingatlas.arcgis.com/wayback/#mapCenter=LONGITUDE%2CLATITUDE%2C16&mode=explore
				String url = "https://livingatlas.arcgis.com/wayback/#mapCenter=" +
						URLEncoder.encode(longitude + "," + latitude + ",18", StandardCharsets.UTF_8.toString()) +
						"&mode=explore";
				loadInTab(ImagerySource.ESRI_WAYBACK, selection, url, tab -> loadPlotInEsriWayback(placemarkObject, tab));
			} catch (final Exception e) {
				logger.error("Problems loading ESRI Wayback", e);
			}
		}
	}


	/**
	 * Opens the Collect Earth Leaflet plots map (served by the embedded server)
	 * in a Selenium-driven browser window.
	 */
	/** The plots map window, or null if it is not open (used to lay out the windows). */
	public RemoteWebDriver getLeafletMapDriver() {
		return webDriverLeafletMap;
	}

	/** Opens the plots map window, or loads the plots map again in it if it is open. A failure is logged. */
	public void openLeafletMap() {
		openLeafletMap(null);
	}

	/**
	 * As {@link #openLeafletMap()}, on a plot: the window the user closed comes back on the plot that was open in it
	 * (see {@link #leafletMapUrl}).
	 *
	 * @param plotId the plot to select in the plots map, or null for none
	 */
	public void openLeafletMap(String plotId) {
		try {
			showLeafletMap(plotId);
		} catch (final Exception e) {
			logger.error("Problems loading the Leaflet plots map", e);
		}
	}

	/**
	 * As {@link #openLeafletMap()}, but failing instead of logging an error: {@link PlotsMapKeeper} reopens the window
	 * by itself every few seconds while no browser can start, and says so once, as a warning.
	 *
	 * @return whether the plots map window is open now
	 */
	boolean reopenLeafletMap(String plotId) throws BrowserNotFoundException {
		return showLeafletMap(plotId);
	}

	/**
	 * The address of the plots map, on the plot {@code plotId} if not null: the page selects it once its plots have
	 * loaded, as a click would, and takes the parameter out of its address (see App's controller).
	 *
	 * @param base the address of the embedded server, ending with /
	 */
	static String leafletMapUrl(String base, String plotId) {
		String url = base + "map";
		if (StringUtils.isBlank(plotId)) {
			return url;
		}
		return url + "?plot=" + URLEncoder.encode(plotId, StandardCharsets.UTF_8);
	}

	private boolean showLeafletMap(String plotId) throws BrowserNotFoundException {
		Object lock = getOrCreateLock(BrowserType.LEAFLET_MAP);
		synchronized (lock) {
			String url = leafletMapUrl(ServerController.getHostAddress(localPropertiesService.getHost(),
					localPropertiesService.getLocalPort()), plotId);
			RemoteWebDriver previous = webDriverLeafletMap;
			if (previous == null || !isDriverWorking(previous)) {
				if (previous != null) {
					// The user closed the window. Its driver outlives it (and on macOS the browser too, with no
					// window): quit, so that every reopen does not leave one more behind until Collect Earth closes
					drivers.remove(previous);
					quietlyQuit(previous);
				}
				webDriverLeafletMap = initAppWindow(null);
			}
			// No refresh after it: the page takes ?plot= out of its address as soon as it starts, so a refresh would load it
			// again on no plot. Its address has no #fragment, so the navigation alone loads the page anew.
			webDriverLeafletMap = navigateTo(url, webDriverLeafletMap, true, false);
			if (webDriverLeafletMap == null) {
				return false;
			}
		}
		for (Runnable listener : leafletMapOpenedListeners) {
			listener.run();
		}
		return true;
	}

	/**
	 * Called after the plots map window opened or loaded again, on the thread that opened it: {@link PlotsMapKeeper}
	 * keeps it open from then on.
	 */
	public void onLeafletMapOpened(Runnable listener) {
		leafletMapOpenedListeners.add(listener);
	}

	/** Whether Collect Earth is closing its browsers: no window is to be opened again then. */
	public boolean isClosing() {
		return isClosing;
	}

	/**
	 * Waits for an element to be present by ID or name.
	 * Polls at regular intervals until element appears or timeout is reached.
	 *
	 * @param elementId The element ID to wait for
	 * @param driver The WebDriver instance
	 * @return true if element appears within timeout, false otherwise
	 */
	public boolean waitFor(String elementId, RemoteWebDriver driver) {
		long endTime = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(ELEMENT_WAIT_TIMEOUT_SECONDS);

		while (System.currentTimeMillis() < endTime) {
			if (isElementPresentByIdOrName(elementId, driver)) {
				return true;
			}
			try {
				Thread.sleep(WAIT_POLL_INTERVAL_MILLIS);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				logger.debug("Interrupted while waiting for element: {}", elementId);
				return false;
			}
		}

		logger.debug("Timeout waiting for element: {}", elementId);
		return false;
	}

	private Thread getClosingBrowsersThread() {
		return new Thread("Quit the open browsers") {
			@Override
			public void run() {
				isClosing = true;
				for (RemoteWebDriver remoteWebDriver : drivers) {
					try {
						remoteWebDriver.quit();
					} catch (final Exception e) {
						// Collect Earth is closing : a browser that is already gone - the interpreter closed it, or its
						// driver stopped first - is the expected case, not a failure to report
						logger.warn("A browser could not be quit, it had probably been closed already : {}", e.getMessage());
					}
				}
			}
		};
	}

}
