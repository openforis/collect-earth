package org.openforis.collect.earth.app.service;

import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.StringWriter;
import java.io.Writer;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Observable;
import java.util.Observer;
import java.util.concurrent.CopyOnWriteArrayList;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.desktop.ServerController.ServerInitializationEvent;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import freemarker.cache.FileTemplateLoader;
import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;
import freemarker.template.Version;
import io.github.bonigarcia.wdm.WebDriverManager;

/**
 * This class contains methods that allow Collect Earth to open browser windows
 * that allow the user to have a better understanding of the plot. So far there
 * are integrations with Google Earth Engine, Google Earth Engine Timelapse and
 * Bing Maps. When a user clicks on a plot Collect Earth will check if the
 * program is set to open any of these integrations, and if it is so it will
 * open each one in its own window. These windows are closed when the program
 * is closed.
 *s
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class BrowserService implements InitializingBean, Observer {


	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private GeolocalizeMapService geoLocalizeTemplateService;

	@Autowired
	private EarthSurveyService earthSurveyService;

	@Autowired
	private CodeEditorHandlerThread codeEditorHandlerThread;

	private final ArrayList<RemoteWebDriver> drivers = new ArrayList<>();
	private final Logger logger = LoggerFactory.getLogger(BrowserService.class);
	private static final String TEMPLATE_FOR_DGMAP_JS = "resources/javascript_dgmap.fmt";
	private static final Configuration cfg = new Configuration(new Version("2.3.23"));
	private RemoteWebDriver webDriverBing, webDriverBaidu, webDriverTimelapse, webDriverGeeCodeEditor,
	webDriverHere, webDriverStreetView, webDriverYandex, webDriverPlanetHtml, webDriverExtraMap, webDriverSecureWatch,
	webDriverGEEMap, webDriverEarthMap;


	Map<String,String> locks = new HashMap<String,String>();

	private static boolean geeMethodUpdated = false;

	private boolean isClosing = false;

	public void closeBrowsers() {
		synchronized (this) {
			getClosingBrowsersThread().start();
		}
	}

	@Override
	public void afterPropertiesSet() throws Exception {
		Runtime.getRuntime().addShutdownHook(getClosingBrowsersThread());
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
		/* SAFARI support removed! 7/12/22
		else if (browserSetInProperties.equalsIgnoreCase(EarthConstants.SAFARI_BROWSER)) {
			driver = tryStartSafari();
		}
		*/

		// If the browser chosen is not installed try to find and installed browser in the computer
		if( driver== null ) {
			driver = tryStartChrome();
			if( driver== null ) {
				driver = tryStartFirefox();
			}
			if( driver== null ) {
				driver = tryStartEdge();
			}
			/* SAFARI support removed! 7/12/22
			if( driver== null ) {
				driver = tryStartSafari();
			}
			*/
		}

		if (driver == null) {
			throw new BrowserNotFoundException(
					"Neither Chrome, Edege or Firefox could be opened. You need to have one of them installed in order to use GEE, Bing Maps or Saiku.");
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
			logger.warn(
					"Problem starting Edge browser",
							e);
		}
		return driver;
	}

	/* SAFARI support removed! 7/12/22
	private RemoteWebDriver tryStartSafari() {
		RemoteWebDriver driver = null;
		try {
			driver = (RemoteWebDriver) WebDriverManager.safaridriver().create();
		} catch (final WebDriverException e) {
			logger.warn(
					"Problem starting Safari browser",
							e);
		}
		return driver;
	}
	*/

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
		Writer out;
		String result = null;
		try (StringWriter fw = new StringWriter();) {
			// Load template from source folder
			cfg.setTemplateLoader(new FileTemplateLoader(new File(System.getProperty("user.dir"))));
			final Template template = cfg.getTemplate(templateName);

			// Console output
			out = new BufferedWriter(fw);

			// Add date to avoid caching
			template.process(data, out);

			out.flush();

			result = fw.toString();

		} catch (final TemplateException e) {
			logger.error("Error when generating the javascript commands", e);
		} catch (final IOException e) {
			logger.error("Error when reading/writing the template information", e);
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

	public static boolean isIdOrNamePresent(String elementId, RemoteWebDriver driver) {
		boolean found = false;

		try {
			if (driver.findElement(By.id(elementId)).isDisplayed() || driver.findElement(By.name(elementId)).isDisplayed()) {
				found = true;
			}
		} catch (final Exception e) {
			// Not found
		}

		return found;
	}

	public static boolean isCssElementPresent(String cssElement, RemoteWebDriver driver) {
		boolean found = false;

		try {
			WebElement elementByCssSelector = driver.findElement(By.cssSelector(cssElement));
			found = elementByCssSelector != null;
		} catch (final Exception e) {
			// Not found
		}

		return found;
	}

	private boolean isXPathPresent(String xpath, RemoteWebDriver driver) {
		boolean found = false;

		try {
			if (driver.findElement(By.xpath(xpath)).isDisplayed()) {
				found = true;
			}
			logger.debug(String.format("Found %s", xpath));
		} catch (final Exception e) {
			logger.debug(String.format("Not Found %s", xpath));
		}

		return found;
	}

	private boolean loadPlotInDGMap(SimplePlacemarkObject placemarkObject, RemoteWebDriver driver) {

		boolean success = true;
		if (driver != null && waitFor("mainContent", driver) && driver instanceof JavascriptExecutor) {
			try {
				String dgmapJs = getDGMapJavascript(placemarkObject);
				driver.executeScript(dgmapJs);

				Thread.sleep( 1000 );
				// Unlock the view if it is locked
				if( isCssElementPresent(".lock.on",  driver)  ) {
					driver.findElement(By.cssSelector(".lock.on")).click(); // UNLOCK
				}

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

	public static boolean isGeeMethodUpdated() {
		return geeMethodUpdated;
	}

	public static void setGeeMethodUpdated(boolean geeMethosUpdated) {
		BrowserService.geeMethodUpdated = geeMethosUpdated;
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
	 * Opens a browser window with the Bing Maps representation of the plot.
	 *
	 * @param placemarkObject
	 *            The data of the plot.
	 * @throws BrowserNotFoundException
	 *             In case the browser could not be found
	 *
	 */
	public void openBingMaps(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("BING");
		synchronized (lock) {
			if (localPropertiesService.isBingMapsSupported()) {
				try {
					webDriverBing = navigateTo(geoLocalizeTemplateService
							.getUrlToFreemarkerOutput(placemarkObject, GeolocalizeMapService.FREEMARKER_BING_HTML_TEMPLATE,
									"bingMapsKey", localPropertiesService.getValue(EarthProperty.BING_MAPS_KEY))
							.toString(), webDriverBing);
				} catch (final Exception e) {
					logger.error("Problems loading Bing", e);
				}
			}
		}
	}

	private Object getLock(String key) {
		String lock = locks.get(key);
		if( lock !=null ) {
			return lock;
		}else{
			locks.put(key, key);
			return key;
		}
	}

	/**
	 * Opens a browser window with the Planet Basemaps representation of the plot.
	 *
	 * @param placemarkObject
	 *            The data of the plot.
	 * @throws BrowserNotFoundException
	 *             In case the browser could not be found
	 *
	 */
	public void openPlanetMaps(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("PLANET");
		synchronized (lock) {
			if (localPropertiesService.isPlanetMapsSupported()) {

				boolean monthly = localPropertiesService.isPlanetMapsMonthlyOpen();

				String template = monthly ? GeolocalizeMapService.FREEMARKER_PLANET_NICFI_ARGUMENTS : GeolocalizeMapService.FREEMARKER_PLANET_DAILY_HTML_TEMPLATE;
				String key = monthly ? localPropertiesService.getValue( EarthProperty.PLANET_MAPS_CE_KEY ) : localPropertiesService.getValue( EarthProperty.PLANET_MAPS_KEY );

				try {

					String processTemplate = geoLocalizeTemplateService.getUrlToFreemarkerOutput(
							placemarkObject,
							template,
							"planetMapsKey",
							key,
							"urlPlanetEndpointPrefix",
							ServerController.getHostAddress(localPropertiesService.getHost(),localPropertiesService.getPort())
						).toString();

					String urlPlanet = null;
					if( monthly ) {

				        String parameters = FileUtils.readFileToString( new File( new URI( processTemplate )  ) , StandardCharsets.UTF_8 );

				        if( StringUtils.isNotBlank( localPropertiesService.getValue( EarthProperty.PLANET_FROM_DATE) ) ) {
				        
				        	parameters += "&planet_date_from=" + localPropertiesService.getValue( EarthProperty.PLANET_FROM_DATE); 
				        	
				        }
				        if( StringUtils.isNotBlank( localPropertiesService.getValue( EarthProperty.PLANET_TO_DATE) ) ) {
					        
				        	parameters += "&planet_date_to=" + localPropertiesService.getValue( EarthProperty.PLANET_TO_DATE); 
				        	
				        }
				        
						// remove new lines
				        parameters = parameters.replace("\n", "").replace("\r", "").replace("\t", "").replace(" ", "");
						// remove trailing commas
				        parameters = parameters.replace(",],", "],").replace("],]", "]]");

						urlPlanet = localPropertiesService.getValue( EarthProperty.PLANET_NICFI_URL ) + parameters;
					}else {
						urlPlanet = processTemplate;
					}

					webDriverPlanetHtml = navigateTo( urlPlanet, webDriverPlanetHtml );

				} catch (final Exception e) {
					logger.error("Problems loading Planet", e);
				}
			}
		}
	}

	/**
	 * Opens a browser window with the Baidu Maps representation of the plot.
	 *
	 * @param placemarkObject
	 *            The data of the plot.
	 * @throws BrowserNotFoundException
	 *             In case the browser could not be found
	 *
	 */
	public void openBaiduMaps(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("BAIDU");
		synchronized (lock) {
			if (localPropertiesService.isBaiduMapsSupported()) {

				try {
					webDriverBaidu = navigateTo(geoLocalizeTemplateService
							.getUrlToFreemarkerOutput(placemarkObject, GeolocalizeMapService.FREEMARKER_BAIDU_HTML_TEMPLATE)
							.toString(), webDriverBaidu);
				} catch (final Exception e) {
					logger.error("Problems loading Baidu", e);
				}
			}
		}
	}

	/**
	 * Opens a browser window with the Yandex Maps representation of the plot.
	 *
	 * @param placemarkObject
	 *            The data of the plot.
	 * @throws BrowserNotFoundException
	 *             In case the browser could not be found
	 *
	 */
	public void openYandexMaps(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("YANDEX");
		synchronized (lock) {
			if (localPropertiesService.isYandexMapsSupported()) {
				try {
					webDriverYandex = navigateTo(geoLocalizeTemplateService.getUrlToFreemarkerOutput(placemarkObject,
							GeolocalizeMapService.FREEMARKER_YANDEX_HTML_TEMPLATE).toString(), webDriverYandex);
				} catch (final Exception e) {
					logger.error("Problems loading Yandex", e);
				}
			}
		}
	}

	/**
	 * Opens a browser window with a map representation of the plot in SecureWatch.
	 *
	 * @param placemarkObject
	 *            The data of the plot.
	 * @throws BrowserNotFoundException
	 *             In case the browser could not be found
	 *
	 */
	public void openSecureWatch(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("SECUREWATCH");
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
	 * @param placemarkObject
	 *            The data of the plot.
	 * @throws BrowserNotFoundException
	 *             In case the browser could not be found
	 *
	 */
	public void openExtraMap(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("EXTRA");
		synchronized (lock) {
			if (!StringUtils.isBlank(localPropertiesService.getExtraMap())) {
				webDriverExtraMap = navigateTo( getUrlBaseIntegration(placemarkObject, localPropertiesService.getExtraMap() ) , webDriverExtraMap );
			}
		}
	}

	private String getUrlBaseIntegration(SimplePlacemarkObject placemarkObject, String url) {
		String temp = null;
		try {
			String latitude = placemarkObject.getCoord().getLatitude();
			String longitude = placemarkObject.getCoord().getLongitude();
			String id = placemarkObject.getPlacemarkId().split(",")[0]; // for cases where ID also has round, then
			// the id string would be something like
			// "plotId,round", we only want the ID

			temp = url.replace("LATITUDE", latitude).replace("LONGITUDE", longitude).replace("PLOT_ID", id);

		} catch (final Exception e) {
			logger.error("Problems Getting the URL filling for " + url, e);
		}
		return temp;
	}

	/**
	 * Opens a browser window with the Google Street View representation of the
	 * plot.
	 * https://www.google.com/maps/@43.7815661,11.1484876,3a,75y,210.23h,82.32t/data=!3m6!1e1!3m4!1sEz7NiCbaIYzTJkP_RMBiqw!2e0!7i13312!8i6656?hl=en
	 *
	 * @param placemarkObject
	 *            The data of the plot.
	 * @throws BrowserNotFoundException
	 *             In case the browser could not be found
	 *
	 */
	public void openStreetView(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("STREET_VIEW");
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

	/**
	 * Opens a browser window with the Here Maps representation of the plot.
	 *
	 * @param placemarkObject
	 *            The data of the plot.
	 * @throws BrowserNotFoundException
	 *             In case the browser could not be found
	 *
	 */
	public void openHereMaps(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("HERE");
		synchronized (lock) {
			if (localPropertiesService.isHereMapsSupported()) {
				try {
					webDriverHere = navigateTo(geoLocalizeTemplateService
							.getUrlToFreemarkerOutput(placemarkObject, GeolocalizeMapService.FREEMARKER_HERE_HTML_TEMPLATE,
									"hereAppId", localPropertiesService.getValue(EarthProperty.HERE_MAPS_APP_ID),
									"hereAppCode", localPropertiesService.getValue(EarthProperty.HERE_MAPS_APP_CODE))
							.toString(), webDriverHere);
				} catch (final Exception e) {
					logger.error("Problems loading Here Maps", e);
				}

			}
		}
	}

	private StringBuilder getGeoJsonSegment(List<SimpleCoordinate> coordinates) {
		StringBuilder geoJson = new StringBuilder("[");
		if (coordinates != null) {
			for (SimpleCoordinate coord : coordinates) {
				geoJson = geoJson.append("[").append(coord.getLongitude()).append(",").append(coord.getLatitude())
						.append("],");
			}
			// remove last character
			geoJson = geoJson.deleteCharAt(geoJson.length() - 1);
		}
		geoJson = geoJson.append("],");
		return geoJson;
	}




	private String getFeature(SimplePlacemarkObject placemarkObject, String shapeType, String name ) {
		StringBuilder feature = new StringBuilder("{\"type\":\"Feature\",\"properties\":{\"name\":\"").append( name).append("\"},\"geometry\":");
		feature= feature.append(   getGeoJson(placemarkObject, shapeType )).append("}");
		return feature.toString();
	}

	private String getGeoJson(SimplePlacemarkObject placemarkObject, String shapeType ) {

		StringBuilder geoJson = new StringBuilder("{\"type\":\"" ).append( shapeType).append("\",\"coordinates\":[");
		List<SimpleCoordinate> shape = placemarkObject.getShape();
		geoJson = geoJson.append(getGeoJsonSegment(shape));
		geoJson = geoJson.deleteCharAt(geoJson.length() - 1);
		geoJson = geoJson.append("]}");
		return geoJson.toString();
	}

	/**
	 * Opens a browser window with the Google Earth Engine Code Editor and runs the
	 * freemarker template found in resources/eeCodeEditorScript.fmt on the main
	 * editor of GEE.
	 *
	 * @param placemarkObject
	 *            The center point of the plot.
	 * @throws BrowserNotFoundException
	 *             If the browser cannot be found
	 *
	 */
	public void openGEEAppURL(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("GEEAPP");
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
					webDriverGEEMap.navigate().refresh();  // FORCE REFRESH - OTHERWISE WINDOW IS NOT REFRESHED FOR SOME STRANGE REASON
				} catch (final Exception e) {
					logger.error("Problems loading GEE APP window", e);
				}
			}
		}
	}


	public void openEarthMapURL(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("EARTH_MAP");
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
					//Desktop.getDesktop().browse( new URI( url.toString() ) );
					//webDriverEarthMap.navigate().refresh();  // FORCE REFRESH - OTHERWISE WINDOW IS NOT REFRESHED FOR SOME STRANGE REASON
				} catch (final Exception e) {
					logger.error("Problems loading Earth Map window", e);
				}
			}
		}
	}

	/**
	 * Opens a browser window with the Google Earth Engine Code Editor and runs the
	 * freemarker template found in resources/eeCodeEditorScript.fmt on the main
	 * editor of GEE.
	 *
	 * @param placemarkObject
	 *            The center point of the plot.
	 * @throws BrowserNotFoundException
	 *             If the browser cannot be found
	 *
	 */
	public void openGEECodeEditor(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("CODE_EDITOR");
		synchronized (lock) {
			if (localPropertiesService.isCodeEditorSupported()) {

				boolean firstOpening = false;
				if (getWebDriverGeeCodeEditor() == null) {
					setWebDriverGeeCodeEditor(initBrowser());
					firstOpening = true;
				}

				if (firstOpening && (SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX )) {
					codeEditorHandlerThread.disableCodeEditorAutocomplete(getWebDriverGeeCodeEditor());
				}

				codeEditorHandlerThread.loadCodeEditorScript(placemarkObject, getWebDriverGeeCodeEditor());
			}
		}
	}


	/**
	 * Opens a browser window with the Google Earth Engine Timelapse representation
	 * of the plot.
	 *
	 * @param placemarkObject
	 *            The center point of the plot.
	 * @throws BrowserNotFoundException
	 *             If the browser cannot be found
	 *
	 */
	public void openTimelapse(final SimplePlacemarkObject placemarkObject)
			throws BrowserNotFoundException {
		Object lock = getLock("TIMELAPSE");
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

	public boolean waitFor(String elementId, RemoteWebDriver driver) {
		int i = 0;
		while (!isIdOrNamePresent(elementId, driver)) {
			try {
				Thread.sleep(1000);
			} catch (final InterruptedException e) {
				return false;
			}
			i++;
			if (i > 60) {
				return false;
			}
		}
		return true;
	}

	public boolean waitForXPath(String xpath, RemoteWebDriver driver) {
		int i = 0;
		while (!isXPathPresent(xpath, driver)) {
			try {
				Thread.sleep(1000);
			} catch (final InterruptedException e) {
				return false;

			}
			i++;
			if (i > 30) {
				return false;
			}
		}
		return true;
	}

	private Thread getClosingBrowsersThread() {

		return new Thread("Quit the open browsers") {
			@Override
			public void run() {
				isClosing = true;
				CopyOnWriteArrayList<RemoteWebDriver> driversCopy = new CopyOnWriteArrayList<>(drivers);
				for (Iterator<RemoteWebDriver> iterator = driversCopy.iterator(); iterator.hasNext();) {
					RemoteWebDriver remoteWebDriver = iterator.next();
					try {
						remoteWebDriver.quit();
					} catch (final Exception e) {
						logger.error("Error quitting the browser", e);
					}
				}

			}
		};
	}

	@Override
	public void update(Observable o, Object arg) {
		if (ServerInitializationEvent.SERVER_STOPPED_EVENT.equals(arg)) {
			this.closeBrowsers();
		}
	}

	private RemoteWebDriver getWebDriverGeeCodeEditor() {
		return webDriverGeeCodeEditor;
	}

	protected void setWebDriverGeeCodeEditor(RemoteWebDriver webDriverGeeCodeEditor) {
		this.webDriverGeeCodeEditor = webDriverGeeCodeEditor;
	}

}
