package org.openforis.collect.earth.app.service;

import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.StringWriter;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.remote.RemoteWebDriver;
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

	// Browser type enumeration for thread-safe lock management
	private enum BrowserType {
		PLANET, SECUREWATCH, EXTRA, STREET_VIEW, GEEAPP, EARTH_MAP, TIMELAPSE, ESRI_WAYBACK
	}

	// Constants for timeouts and wait durations
	private static final int ELEMENT_WAIT_TIMEOUT_SECONDS = 60;
	private static final int XPATH_WAIT_TIMEOUT_SECONDS = 30;
	private static final int WAIT_POLL_INTERVAL_MILLIS = 1000;
	private static final int PLOT_LOAD_SLEEP_MILLIS = 1000;

	// CSS selectors
	private static final String CSS_LOCK_ON = ".lock.on";

	// Template paths
	private static final String TEMPLATE_FOR_DGMAP_JS = "resources/javascript_dgmap.fmt";


	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private GeolocalizeMapService geoLocalizeTemplateService;

	@Autowired
	private EarthSurveyService earthSurveyService;

	private final CopyOnWriteArrayList<RemoteWebDriver> drivers = new CopyOnWriteArrayList<>();
	private final Logger logger = LoggerFactory.getLogger(BrowserService.class);
	private final Configuration freemarkerConfig = createFreemarkerConfiguration();

	// Volatile to ensure visibility across threads when modified within synchronized blocks
	private volatile RemoteWebDriver webDriverTimelapse, webDriverStreetView, webDriverPlanetHtml,
	                        webDriverExtraMap, webDriverSecureWatch, webDriverGEEMap, webDriverEarthMap,
	                        webDriverEsriWayback;

	private final Map<BrowserType, Object> locks = new ConcurrentHashMap<>();

	private volatile boolean geeMethodUpdated = false;
	private volatile boolean isClosing = false;

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

	private String processJavascriptTemplate(final Map<String, Object> data, String templateName) {
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
			return driver.findElement(By.id(elementId)).isDisplayed() ||
			       driver.findElement(By.name(elementId)).isDisplayed();
		} catch (final Exception e) {
			// Element not found - this is expected behavior, not an error
			return false;
		}
	}

	/**
	 * @deprecated Use {@link #isElementPresentByIdOrName(String, RemoteWebDriver)} instead
	 */
	@Deprecated
	public static boolean isIdOrNamePresent(String elementId, RemoteWebDriver driver) {
		return isElementPresentByIdOrName(elementId, driver);
	}

	/**
	 * Checks if an element is present by CSS selector.
	 *
	 * @param cssElement The CSS selector
	 * @param driver The WebDriver instance
	 * @return true if element is found, false otherwise
	 */
	public static boolean isCssElementPresent(String cssElement, RemoteWebDriver driver) {
		try {
			driver.findElement(By.cssSelector(cssElement));
			return true;
		} catch (final Exception e) {
			// Element not found - this is expected behavior, not an error
			return false;
		}
	}

	/**
	 * Checks if an element is present and displayed by XPath.
	 *
	 * @param xpath The XPath expression
	 * @param driver The WebDriver instance
	 * @return true if element is found and displayed, false otherwise
	 */
	private boolean isXPathPresent(String xpath, RemoteWebDriver driver) {
		try {
			boolean found = driver.findElement(By.xpath(xpath)).isDisplayed();
			if (found) {
				logger.debug("Found element by XPath: {}", xpath);
			}
			return found;
		} catch (final Exception e) {
			logger.debug("Element not found by XPath: {}", xpath);
			return false;
		}
	}

	/**
	 * Loads a plot into the DGMap interface with JavaScript execution.
	 *
	 * @param placemarkObject The placemark data to load
	 * @param driver The WebDriver instance
	 * @return true if successful, false otherwise
	 */
	private boolean loadPlotInDGMap(SimplePlacemarkObject placemarkObject, RemoteWebDriver driver) {
		boolean success = true;
		if (driver != null && waitFor("mainContent", driver) && driver instanceof JavascriptExecutor) {
			try {
				String dgmapJs = getDGMapJavascript(placemarkObject);
				driver.executeScript(dgmapJs);

				Thread.sleep(PLOT_LOAD_SLEEP_MILLIS);
				// Unlock the view if it is locked
				if (isCssElementPresent(CSS_LOCK_ON, driver)) {
					driver.findElement(By.cssSelector(CSS_LOCK_ON)).click(); // UNLOCK
				}

			} catch (final InterruptedException e) {
				Thread.currentThread().interrupt();
				logger.warn("Thread interrupted while loading plot in DGMap", e);
				success = false;
			} catch (final Exception e) {
				processSeleniumError(e);
				success = false;
			}
		}
		return success;
	}

	public void clickOnElements(RemoteWebDriver driver, String cssSelector) {
		final List<WebElement> dataLayerVisibility = driver.findElements(By.cssSelector(cssSelector));
		for (final WebElement webElement : dataLayerVisibility) {
			if (webElement.isDisplayed()) {
				webElement.click();
			}
		}
	}

	public boolean isGeeMethodUpdated() {
		return geeMethodUpdated;
	}

	public void setGeeMethodUpdated(boolean geeMethodUpdated) {
		this.geeMethodUpdated = geeMethodUpdated;
	}

	private void processSeleniumError(final Exception e) {
		if (e.getCause() != null && e.getCause().getMessage() != null
				&& !e.getCause().getMessage().contains("latitude")) {
			logger.warn("Error in the selenium driver", e);
		} else {
			logger.info("Error in the selenium driver provoked by known bug", e);
		}
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

		RemoteWebDriver driver = driverParam;

		if (driver == null || !isDriverWorking(driver)) {
			driver = initBrowser();
		}

		if (driver != null) {
			try {
				driver.navigate().to(url);
				// Refresh to make sure it loads the new plot
				try {
					driver.navigate().refresh(); // FORCE REFRESH - OTHERWISE WINDOW IS NOT REFRESHED
				} catch (final Exception e) {
					logger.error("Error refreshing the browser window", e);
				}
			} catch (final Exception e) {
				if (retry && (e.getCause() != null && e.getCause().getMessage() != null
						&& e.getCause().getMessage().contains("Session not found"))) {
					// Browser closed, restart it!
					logger.error("Browser was closed, restaring it...", e);
					driver = initBrowser();
					navigateTo(url, driver, false); // only try to re-open one
				}
			}
		} else {
			logger.error("No Selenium driver available, Is Firefox or Chrome installed?");
		}
		return driver;
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
	 * Opens a browser window with the Planet Basemaps representation of the plot.
	 * Supports two modes:
	 * - TFO mode: Opens the hosted planet.html page with NICFI monthly basemaps
	 * - Daily mode: Uses local Freemarker template with Planet Daily API
	 *
	 * @param placemarkObject The data of the plot.
	 * @throws BrowserNotFoundException In case the browser could not be found
	 */
	public void openPlanetMaps(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getOrCreateLock(BrowserType.PLANET);
		synchronized (lock) {
			if (localPropertiesService.isPlanetMapsSupported()) {
				try {
					if (localPropertiesService.isPlanetMapsUseTfo()) {
						// TFO mode: Use hosted planet.html with NICFI monthly basemaps
						openPlanetTfoMode(placemarkObject);
					} else {
						// Daily mode: Use local Freemarker template with Planet Daily API
						openPlanetDailyMode(placemarkObject);
					}
				} catch (final Exception e) {
					logger.error("Problems loading Planet", e);
				}
			}
		}
	}

	/**
	 * Opens Planet imagery using the Tropical Forest Observatory (TFO) monthly basemaps.
	 * Opens the hosted planet.html page at openforis.org with URL parameters.
	 * Uses the same API key as Daily mode (PLANET_MAPS_KEY).
	 */
	private void openPlanetTfoMode(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		String apiKey = localPropertiesService.getValue(EarthProperty.PLANET_MAPS_KEY);
		if (StringUtils.isBlank(apiKey)) {
			logger.warn("Planet API key not configured for TFO mode");
			return;
		}

		try {
			StringBuilder url = new StringBuilder("https://openforis.org/fileadmin/planet.html?");

			// Add latlngs parameter (polygon coordinates)
			String latlngs = getLatLngsForPlanetHtml(placemarkObject);
			url.append("latlngs=").append(URLEncoder.encode(latlngs, StandardCharsets.UTF_8.toString()));

			// Add API key
			url.append("&planet_api_key=").append(URLEncoder.encode(apiKey, StandardCharsets.UTF_8.toString()));

			// Add optional date parameters (skip if "Oldest"/"Latest" which represent default/empty values)
			String dateFrom = localPropertiesService.getPlanetTfoDateFrom();
			if (StringUtils.isNotBlank(dateFrom) && !"Oldest".equals(dateFrom)) {
				url.append("&planet_date_from=").append(URLEncoder.encode(dateFrom, StandardCharsets.UTF_8.toString()));
			}

			String dateTo = localPropertiesService.getPlanetTfoDateTo();
			if (StringUtils.isNotBlank(dateTo) && !"Latest".equals(dateTo)) {
				url.append("&planet_date_to=").append(URLEncoder.encode(dateTo, StandardCharsets.UTF_8.toString()));
			}

			webDriverPlanetHtml = navigateTo(url.toString(), webDriverPlanetHtml);

		} catch (final Exception e) {
			logger.error("Problems loading Planet TFO mode", e);
		}
	}

	/**
	 * Opens Planet imagery using the Daily API via local Freemarker template.
	 */
	private void openPlanetDailyMode(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
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

			webDriverPlanetHtml = navigateTo(processTemplate, webDriverPlanetHtml);

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
	 * Opens a browser window with a map representation of the plot in SecureWatch.
	 *
	 * @param placemarkObject The data of the plot.
	 * @throws BrowserNotFoundException In case the browser could not be found
	 */
	public void openSecureWatch(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getOrCreateLock(BrowserType.SECUREWATCH);
		synchronized (lock) {
			if ( localPropertiesService.isSecureWatchSupported() ) {
				String url = getUrlBaseIntegration(placemarkObject, localPropertiesService.getSecureWatchURL() + "/#18/LATITUDE/LONGITUDE" );
				webDriverSecureWatch = navigateTo(url, webDriverSecureWatch);
				try {
					logger.warn("Loading layers - {}", placemarkObject);
					loadPlotInDGMap(placemarkObject, webDriverSecureWatch);
				} catch (final Exception e) {
					logger.error("Error when opening Secure Watch browser window", e);
				}
			}
		}
	}

	/**
	 * Opens a browser window with a map representation of the plot.
	 *
	 * @param placemarkObject The data of the plot.
	 * @throws BrowserNotFoundException In case the browser could not be found
	 */
	public void openExtraMap(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getOrCreateLock(BrowserType.EXTRA);
		synchronized (lock) {
			if (!StringUtils.isBlank(localPropertiesService.getExtraMap())) {
				webDriverExtraMap = navigateTo( getUrlBaseIntegration(placemarkObject, localPropertiesService.getExtraMap() ) , webDriverExtraMap );
			}
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
	 * Opens a browser window with the Google Street View representation of the plot.
	 *
	 * @param placemarkObject The data of the plot.
	 * @throws BrowserNotFoundException In case the browser could not be found
	 */
	public void openStreetView(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getOrCreateLock(BrowserType.STREET_VIEW);
		synchronized (lock) {
			if (localPropertiesService.isStreetViewSupported()) {
				try {
					webDriverStreetView = navigateTo(
							geoLocalizeTemplateService.getUrlToFreemarkerOutput(placemarkObject,
									GeolocalizeMapService.FREEMARKER_STREET_VIEW_HTML_TEMPLATE, "googleMapsApiKey",
									localPropertiesService.getValue(EarthProperty.GOOGLE_MAPS_API_KEY)).toString(),
							webDriverStreetView);
				} catch (final Exception e) {
					logger.error("Problems loading Street View", e);
				}
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
	 * Opens a browser window with the Google Earth Engine App URL.
	 *
	 * @param placemarkObject The center point of the plot.
	 * @throws BrowserNotFoundException If the browser cannot be found
	 */
	public void openGEEAppURL(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getOrCreateLock(BrowserType.GEEAPP);
		synchronized (lock) {
			if (localPropertiesService.isGEEAppSupported()) {

				try {
					StringBuilder url = new StringBuilder(localPropertiesService.getGEEAppURL());
					url = url.append("#geoJson=")
							.append(URLEncoder.encode(getGeoJson(placemarkObject, "MultiLineString"), StandardCharsets.UTF_8.toString()))
							.append(";");
					url = url.append("plotId=")
							.append(URLEncoder.encode(placemarkObject.getPlacemarkId(), StandardCharsets.UTF_8.toString()))
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
					
					webDriverGEEMap = navigateTo(url.toString(), webDriverGEEMap);
				} catch (final Exception e) {
					logger.error("Problems loading GEE APP window", e);
				}
			}
		}
	}


	/**
	 * Opens a browser window with the Earth Map URL.
	 *
	 * @param placemarkObject The placemark data
	 * @throws BrowserNotFoundException If the browser cannot be found
	 */
	public void openEarthMapURL(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getOrCreateLock(BrowserType.EARTH_MAP);
		synchronized (lock) {
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

					webDriverEarthMap = navigateTo(url.toString(), webDriverEarthMap);
				} catch (final Exception e) {
					logger.error("Problems loading Earth Map window", e);
				}
			}
		}
	}

	/**
	 * Opens a browser window with the Google Earth Engine Timelapse representation of the plot.
	 *
	 * @param placemarkObject The center point of the plot.
	 * @throws BrowserNotFoundException If the browser cannot be found
	 */
	public void openTimelapse(final SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getOrCreateLock(BrowserType.TIMELAPSE);
		synchronized (lock) {
			if (localPropertiesService.isTimelapseSupported()) {
				try {
					String coordinates = placemarkObject.getCoord().toString();
					webDriverTimelapse = navigateTo(
							"https://earthengine.google.org/timelapse/timelapseplayer_v2.html?timelapseclient=http://earthengine.google.org/timelapse/data&v="
									+ coordinates + ",10.812,latLng&t=0.08",
									webDriverTimelapse);
				} catch (final Exception e) {
					logger.error("Problems loading Timelapse", e);
				}
			}
		}
	}

	/**
	 * Opens a browser window with ESRI World Imagery Wayback centered on the plot.
	 *
	 * @param placemarkObject The center point of the plot.
	 * @throws BrowserNotFoundException If the browser cannot be found
	 */
	public void openEsriWayback(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getOrCreateLock(BrowserType.ESRI_WAYBACK);
		synchronized (lock) {
			if (localPropertiesService.isEsriWaybackSupported()) {
				try {
					String longitude = placemarkObject.getCoord().getLongitude();
					String latitude = placemarkObject.getCoord().getLatitude();
					// URL format: https://livingatlas.arcgis.com/wayback/#mapCenter=LONGITUDE%2CLATITUDE%2C16&mode=explore
					String url = "https://livingatlas.arcgis.com/wayback/#mapCenter=" +
							URLEncoder.encode(longitude + "," + latitude + ",18", StandardCharsets.UTF_8.toString()) +
							"&mode=explore";
					webDriverEsriWayback = navigateTo(url, webDriverEsriWayback);
				} catch (final Exception e) {
					logger.error("Problems loading ESRI Wayback", e);
				}
			}
		}
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

	/**
	 * Waits for an element to be present by XPath.
	 * Polls at regular intervals until element appears or timeout is reached.
	 *
	 * @param xpath The XPath expression to wait for
	 * @param driver The WebDriver instance
	 * @return true if element appears within timeout, false otherwise
	 */
	public boolean waitForXPath(String xpath, RemoteWebDriver driver) {
		long endTime = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(XPATH_WAIT_TIMEOUT_SECONDS);

		while (System.currentTimeMillis() < endTime) {
			if (isXPathPresent(xpath, driver)) {
				return true;
			}
			try {
				Thread.sleep(WAIT_POLL_INTERVAL_MILLIS);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				logger.debug("Interrupted while waiting for XPath: {}", xpath);
				return false;
			}
		}

		logger.debug("Timeout waiting for XPath: {}", xpath);
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
						logger.error("Error quitting the browser", e);
					}
				}
			}
		};
	}

}
