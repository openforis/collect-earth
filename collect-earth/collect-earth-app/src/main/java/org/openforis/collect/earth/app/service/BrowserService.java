package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.StringWriter;
import java.io.Writer;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.Security;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Observable;
import java.util.Observer;
import java.util.Properties;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.zip.GZIPInputStream;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;

import org.apache.commons.lang3.StringUtils;
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
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeDriverService;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.firefox.FirefoxBinary;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;
import org.openqa.selenium.firefox.GeckoDriverService;
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
import liquibase.util.SystemUtils;

/**
 * This class contains methods that allow Collect Earth to open browser windows
 * that allow the user to have a better understanding of the plot. So far there
 * are integrations with Google Earth Engine, Google Earth Engine Timelapse and
 * Bing Maps. When a user clicks on a plot Collect Earth will check if the
 * program is set to open any of these integrations, and if it is so it will
 * open each one in its own window. These windows are closed when the program
 * is closed.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Component
public class BrowserService implements InitializingBean, Observer {

	private static final String NEW = "=new ";
	private static final String PROTOTYPE = ".prototype";
	private static final String ZOOM_10 = "zoom,10)";
	private static final String WORKSPACE_EL = "(\"workspace-el\");";
	private static final String LAYER_CONTAINER_BODY = "layer-container-body";

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private GeolocalizeMapService geoLocalizeTemplateService;

	@Autowired
	private CodeEditorHandlerThread codeEditorHandlerThread;

	private final ArrayList<RemoteWebDriver> drivers = new ArrayList<>();
	private final Logger logger = LoggerFactory.getLogger(BrowserService.class);
	private static final String TEMPLATE_FOR_GEE_JS = "resources/javascript_gee.fmt";
	private static final String TEMPLATE_FOR_DGMAP_JS = "resources/javascript_dgmap.fmt";
	private static final Configuration cfg = new Configuration(new Version("2.3.23"));
	private RemoteWebDriver webDriverEE, webDriverBing, webDriverBaidu, webDriverTimelapse, webDriverGeeCodeEditor,
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
		setGeckoDriverPath();
	}

	private RemoteWebDriver chooseDriver() throws BrowserNotFoundException {
		RemoteWebDriver driver = null;
		final String browserSetInProperties = localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE);

		if (browserSetInProperties.trim().equalsIgnoreCase(EarthConstants.CHROME_BROWSER)) {
			driver = tryStartChrome();
			if (driver == null) {
				driver = tryStartFirefox();
			}
		} else {
			driver = tryStartFirefox();
			if (driver == null) {
				driver = tryStartChrome();
			}
		}

		if (driver == null) {
			throw new BrowserNotFoundException(
					"Neither Chrome nor Firefox could be opened. You need to have one of them installed in order to use GEE, Bing Maps or Saiku.");
		}

		return driver;
	}

	private RemoteWebDriver tryStartFirefox() {
		RemoteWebDriver driver = null;
		try {
			driver = startFirefoxBrowser();
		} catch (final WebDriverException e) {
			logger.warn(
					"The browser executable for Firefox (Firefox.exe) cannot be found, please edit earth.properties and add the firefox.exe location in "
							+ EarthProperty.FIREFOX_BINARY_PATH + " pointing to the full path to firefox",
							e);
		}
		return driver;
	}

	private RemoteWebDriver tryStartChrome() throws BrowserNotFoundException {
		RemoteWebDriver driver = null;
		try {
			driver = startChromeBrowser();
		} catch (final WebDriverException e) {
			logger.warn(
					"The browser executable for Chrome (chrome.exe in Windows) cannot be found, please edit earth.properties and add the chrome.exe location in "
							+ EarthProperty.CHROME_BINARY_PATH + " pointing to the full path to chrome",
							e);
		}
		return driver;
	}

	private String getCompleteGeeJS() throws IOException {

		final StringBuilder jsResult = new StringBuilder();
		try {
			final URL geeJsUrl = new URL(localPropertiesService.getValue(EarthProperty.GEE_JS_LIBRARY_URL));

			// Start Work-around so that we can connect to an HTTPS server without needing
			// to include the certificate
			Security.getProviders();
			final SSLContext ssl = SSLContext.getInstance("TLSv1");
			ssl.init(null, new TrustManager[] { new TrustAllCertificates() }, null);
			final SSLSocketFactory factory = ssl.getSocketFactory();
			final HttpsURLConnection connection = (HttpsURLConnection) geeJsUrl.openConnection();
			connection.setSSLSocketFactory(factory);

			connection.setHostnameVerifier((hostname, session) -> true);
			// End or work-around
			InputStreamReader isr;
			if (connection.getHeaderField("Content-Encoding") != null
					&& connection.getHeaderField("Content-Encoding").equals("gzip")) {
				isr = new InputStreamReader(new GZIPInputStream(connection.getInputStream()));
			} else {
				isr = new InputStreamReader(connection.getInputStream());
			}

			try (BufferedReader in = new BufferedReader(isr);) {
				String inputLine;
				while ((inputLine = in.readLine()) != null) {
					jsResult.append(inputLine);
				}
			}
		} catch (final Exception e) {
			logger.error(
					"Not possible to read URI " + localPropertiesService.getValue(EarthProperty.GEE_JS_LIBRARY_URL), e);
			return null;
		}

		return jsResult.toString();
	}

	private String getGEEJavascript(SimplePlacemarkObject placemarkObject) {

		final Map<String, Object> data = geoLocalizeTemplateService.getPlacemarkData(placemarkObject);
		data.put("latitude", placemarkObject.getCoord().getLatitude());
		data.put("longitude", placemarkObject.getCoord().getLongitude());
		data.put(EarthProperty.GEE_FUNCTION_PICK.toString(),
				localPropertiesService.getValue(EarthProperty.GEE_FUNCTION_PICK));
		data.put(EarthProperty.GEE_ZOOM_OBJECT.toString(),
				localPropertiesService.getValue(EarthProperty.GEE_ZOOM_OBJECT));
		data.put(EarthProperty.GEE_ZOOM_METHOD.toString(),
				localPropertiesService.getValue(EarthProperty.GEE_ZOOM_METHOD));
		data.put(EarthProperty.GEE_INITIAL_ZOOM.toString(),
				localPropertiesService.getValue(EarthProperty.GEE_INITIAL_ZOOM));

		return processJavascriptTemplate(data, TEMPLATE_FOR_GEE_JS );
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
			if (driver.findElementById(elementId).isDisplayed() || driver.findElementByName(elementId).isDisplayed()) {
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
			WebElement elementByCssSelector = driver.findElementByCssSelector(cssElement);
			found = elementByCssSelector != null;
		} catch (final Exception e) {
			// Not found
		}

		return found;
	}

	private boolean isXPathPresent(String xpath, RemoteWebDriver driver) {
		boolean found = false;

		try {
			if (driver.findElementByXPath(xpath).isDisplayed()) {
				found = true;
			}
			logger.debug(String.format("Found %s", xpath));
		} catch (final Exception e) {
			logger.debug(String.format("Not Found %s", xpath));
		}

		return found;
	}

	private boolean loadPlotInDGMap(SimplePlacemarkObject placemarkObject, RemoteWebDriver driver)
			throws InterruptedException {

		boolean success = true;
		if (driver != null && waitFor("mainContent", driver) && driver instanceof JavascriptExecutor) {
			try {
				String dgmapJs = getDGMapJavascript(placemarkObject);
				driver.executeScript(dgmapJs);
				
				Thread.sleep( 1000 );
				// Unlock the view if it is locked
				if( isCssElementPresent(".lock.on",  driver)  ) {
					driver.findElementByCssSelector(".lock.on").click(); // UNLOCK
				}
				
			} catch (final Exception e) {
				processSeleniumError(e);
				success = false;
			}
		}
		return success;
	}

	private boolean loadPlotInGEEExplorer(SimplePlacemarkObject placemarkObject, RemoteWebDriver driver)
			throws InterruptedException, BrowserNotFoundException {

		boolean success = true;

		if (driver != null) {

			if (!isIdOrNamePresent("workspace-el", driver)) {
				String url = localPropertiesService.getValue(EarthProperty.GEE_EXPLORER_URL);
				driver = navigateTo(url, driver);
			}

			if (waitFor("workspace-el", driver) && driver instanceof JavascriptExecutor) {
				try {

					if (!isGeeMethodUpdated()) {
						try {
							refreshJSValues();
						} catch (final Exception e) {
							logger.error("Error checking the validity of the GEE js code", e);
						} finally {
							setGeeMethodUpdated(true);
						}
					}
					String geeJs = getGEEJavascript(placemarkObject);
					driver.executeScript(geeJs);
				} catch (final Exception e) {
					processSeleniumError(e);
				}

				Thread.sleep(1000);
				String eyeShowing = "span.indicator.visible";
				String eyeLoading = "span.indicator.loading";

				clickOnElements(driver, eyeShowing);
				clickOnElements(driver, eyeLoading);
				success = false;
			}
		}
		return success;
	}

	public void clickOnElements(RemoteWebDriver driver, String cssSelector) {
		final List<WebElement> dataLayerVisibility = driver.findElementsByCssSelector(cssSelector);
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
				try {
					webDriverPlanetHtml = navigateTo(
	
							geoLocalizeTemplateService.getUrlToFreemarkerOutput(
									placemarkObject,
									GeolocalizeMapService.FREEMARKER_PLANET_HTML_TEMPLATE, 
									"planetMapsKey",
									localPropertiesService.getValue(EarthProperty.PLANET_MAPS_KEY), 
									"urlPlanetEndpointPrefix",
									ServerController.getHostAddress(
											localPropertiesService.getHost(),
											localPropertiesService.getPort())
									/*"latestUrl",
								new PlanetImagery(localPropertiesService.getPlanetMapsKey()).getLatestUrl(placemarkObject)).toString(), 
									 */).toString(),
							webDriverPlanetHtml
							);
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

			temp = url.replaceAll("LATITUDE", latitude).replaceAll("LONGITUDE", longitude).replaceAll("PLOT_ID", id);

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
							.append("&");
	
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
	
				if (firstOpening && (SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX)) {
					codeEditorHandlerThread.disableCodeEditorAutocomplete(getWebDriverGeeCodeEditor());
				}
	
				codeEditorHandlerThread.loadCodeEditorScript(placemarkObject, getWebDriverGeeCodeEditor());
			}
		}
	}

	/**
	 * Opens a browser window with the Google Earth Engine representation of the
	 * plot. The Landsat 8 Annual Greenest pixel TOA for 2013 is loaded
	 * automatically.
	 * 
	 * @param placemarkObject
	 *            The center point of the plot.
	 * @throws BrowserNotFoundException
	 *             If the browser cannot be found
	 * 
	 */
	public void openGEEExplorer(SimplePlacemarkObject placemarkObject) throws BrowserNotFoundException {
		Object lock = getLock("GEE_EXPLORER");
		synchronized (lock) {
			logger.warn("Starting to open EE - supported : {}", localPropertiesService.isExplorerSupported());
			if (localPropertiesService.isExplorerSupported()) {
	
				if (webDriverEE == null) {
					setGeeMethodUpdated(false); // Force the method to find the GEE specific methods again
					webDriverEE = initBrowser();
				}
	
				try {
					logger.warn("Loading layers - {}", placemarkObject);
					loadPlotInGEEExplorer(placemarkObject, webDriverEE);
				} catch (final Exception e) {
					logger.error("Error when opening Earth Engine browser window", e);
				}
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

	private void refreshJSValues() throws IOException {
		final String jsGee = getCompleteGeeJS();
		if (jsGee != null && jsGee.length() > 0) {
			// try to find this pattern for the gee_js_pickFunction value ("workspace-el");
			// " var b=H("workspace-el"); "
			// New one : var a=F("workspace-el");N(a,!0);N(F("savebox"),!0);if(!this.ya){var
			// e=new google.maps.Map(F("map"),

			final int indexWorkspaceEL = jsGee.indexOf(WORKSPACE_EL);
			int startEquals = 0;
			for (startEquals = indexWorkspaceEL; startEquals > indexWorkspaceEL - 20; startEquals--) {
				if (jsGee.charAt(startEquals) == '=') {
					break;
				}
			}
			final String pickFunction = jsGee.substring(startEquals + 1, indexWorkspaceEL).trim();

			// try to find this pattern for the gee_js_zoom_object value Mt
			// G(g,"layer-container-body");a.na=new Mt(c,b);f.V(a.na,
			final int indexLayer = jsGee.indexOf(LAYER_CONTAINER_BODY, startEquals);
			final int indexEqual = jsGee.indexOf(NEW, indexLayer);
			final int indexParenthesis = jsGee.indexOf('(', indexEqual);

			final String zoomObject = jsGee.substring(indexEqual + NEW.length(), indexParenthesis).trim();

			// try to find this pattern for the gee_js_zoom_function value Mt
			// Mt.prototype.I=function(a){if(ja(a)){Qt(this);var b=a.viewport;if(b){var
			// c=parseInt(b.zoom,10),d=parseFloat(b.lat),
			final int indexZoom10 = jsGee.indexOf(ZOOM_10);
			final int startPrototype = jsGee.indexOf(zoomObject + PROTOTYPE, indexZoom10 - 200);

			final String zoomFunction = jsGee.substring(startPrototype + zoomObject.length() + PROTOTYPE.length() + 1,
					jsGee.indexOf('=', startPrototype)).trim();

			localPropertiesService.setValue(EarthProperty.GEE_FUNCTION_PICK, pickFunction);
			localPropertiesService.setValue(EarthProperty.GEE_ZOOM_METHOD, zoomFunction);
			localPropertiesService.setValue(EarthProperty.GEE_ZOOM_OBJECT, zoomObject);
		}

	}

	private RemoteWebDriver startChromeBrowser() throws BrowserNotFoundException {

		final Properties props = System.getProperties();
		String chromedriverExe = null;
		if (StringUtils.isBlank(props.getProperty(ChromeDriverService.CHROME_DRIVER_EXE_PROPERTY))) {
			if (SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX) {
				chromedriverExe = "resources/chromedriver_mac";
			} else if (SystemUtils.IS_OS_UNIX) {
				chromedriverExe = "resources/chromedriver64";
			} else if (SystemUtils.IS_OS_WINDOWS) {
				chromedriverExe = "resources/chromedriver.exe";
			} else {
				throw new BrowserNotFoundException("Chromedriver is not supported in the current OS");
			}
			props.setProperty(ChromeDriverService.CHROME_DRIVER_EXE_PROPERTY, chromedriverExe);
		}

		String chromeBinaryPath = localPropertiesService.getValue(EarthProperty.CHROME_BINARY_PATH);

		// Handle the special case when the user picks the Chrome or Firefox app files
		// for Mac
		if ((SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX)
				&& (chromeBinaryPath.toLowerCase().endsWith("google chrome.app")
						|| chromeBinaryPath.toLowerCase().endsWith("chrome.app"))) {
			chromeBinaryPath = chromeBinaryPath + "/Contents/MacOS/Google Chrome";
		}

		ChromeOptions chromeOptions = new ChromeOptions();
		chromeOptions.addArguments("disable-infobars");
		chromeOptions.addArguments("disable-save-password-bubble");

		if (!StringUtils.isBlank(chromeBinaryPath)) {
			try {
				chromeOptions.setBinary(chromeBinaryPath);
			} catch (final WebDriverException e) {
				logger.error(
						"The chrome executable chrome.exe cannot be found, please edit earth.properties and correct the chrome.exe location at "
								+ EarthProperty.CHROME_BINARY_PATH + " pointing to the full path to chrome.exe",
								e);
			}
		}

		return new ChromeDriver(chromeOptions);

	}

	private RemoteWebDriver startFirefoxBrowser() {

		// Firefox under version 48 will work in the "old" way with Selenium. For newer
		// versions we need to use the GeckoDriver (Marionette)
		String firefoxBinaryPath = localPropertiesService.getValue(EarthProperty.FIREFOX_BINARY_PATH);

		if (StringUtils.isBlank(firefoxBinaryPath)) {
			firefoxBinaryPath = FirefoxLocatorFixed.tryToFindFolder();
		}
		// Handle the special case when the user picks the Chrome or Firefox app files
		// for Mac
		if ((SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX)
				&& firefoxBinaryPath.toLowerCase().endsWith("firefox.app")) {
			firefoxBinaryPath = firefoxBinaryPath + "/Contents/MacOS/firefox";
		}

		FirefoxBinary fb = null;
		if (firefoxBinaryPath != null) {
			System.setProperty(FirefoxDriver.SystemProperty.BROWSER_BINARY, firefoxBinaryPath);
			fb = new FirefoxBinary(new File(firefoxBinaryPath));
		} else {
			fb = new FirefoxBinary();
		}

		FirefoxOptions fo = new FirefoxOptions();
		fo.setLegacy(false);
		fo.setBinary(fb);
		return new FirefoxDriver(fo);
	}

	private void setGeckoDriverPath() {
		String geckoDriverPath = "";
		if (SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX) {
			geckoDriverPath = "resources/geckodriver_mac";
		} else if (SystemUtils.IS_OS_UNIX) {
			if (System.getProperty("os.arch").contains("64")
					|| System.getProperty("sun.arch.data.model").equals("64")) {
				geckoDriverPath = "resources/geckodriver_64";
			} else {
				geckoDriverPath = "resources/geckodriver_32";
			}
		} else if (SystemUtils.IS_OS_WINDOWS) {
			try {
				if (System.getProperty("os.arch").contains("64")
						|| System.getProperty("sun.arch.data.model").equals("64"))
					geckoDriverPath = "resources/geckodriver_64.exe";
				else
					geckoDriverPath = "resources/geckodriver_32.exe";
			} catch (Exception e) {
				geckoDriverPath = "resources/geckodriver_64.exe";
			}
		} else {
			throw new IllegalArgumentException("Geckodriver is not supported in the current OS");
		}

		File geckoDriverFile = new File(geckoDriverPath);

		// if above property is not working or not opening the application in browser
		// then try below property
		System.setProperty(GeckoDriverService.GECKO_DRIVER_EXE_PROPERTY, geckoDriverFile.getAbsolutePath());
		System.setProperty(FirefoxDriver.SystemProperty.DRIVER_USE_MARIONETTE, "true");

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
