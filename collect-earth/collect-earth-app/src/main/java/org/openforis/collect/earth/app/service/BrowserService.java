package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.StringWriter;
import java.io.Writer;
import java.net.URL;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Observable;
import java.util.Observer;
import java.util.Properties;
import java.util.Vector;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import liquibase.util.SystemUtils;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.firefox.FirefoxBinary;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxProfile;
import org.openqa.selenium.remote.DesiredCapabilities;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.openqa.selenium.remote.UnreachableBrowserException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

/**
 * This class contains methods that allow Collect Earth to open browser windows that allow the user to have a better understanding of the plot.
 * So far there are integrations with Google Earth Engine, Google Earth Engine Timelapse and Bing Maps.
 * When a user clicks on a plot Collect Earth will check if the program is set to open any of these integrations, and if it is so it will opend each
 * one in its own window.
 * These windows are closed when the program is closed.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
@Component
public class BrowserService implements Observer{

	/**
	 * To avoid needing to addd the SSL certificate of Google to the certificate repository we ause a Trust Manager that basically trust all
	 * certificates. Not very safe but it is OK for Collect Earth's contex ( only Goolge Earth Engine is used and no sign-in is necessary )
	 * 
	 * @author Alfonso Sanchez-Paus Diaz
	 * 
	 */
	static class TrustAllCertificates implements X509TrustManager {
		@Override
		public void checkClientTrusted(X509Certificate[] cert, String s) throws CertificateException {
		}

		@Override
		public void checkServerTrusted(X509Certificate[] cert, String s) throws CertificateException {
		}

		@Override
		public X509Certificate[] getAcceptedIssuers() {
			// TODO Auto-generated method stub
			return null;
		}

	}

	private static final String NEW = "=new ";
	private static final String PROTOTYPE = ".prototype";
	private static final String ZOOM_10 = "zoom,10)";
	private static final String WORKSPACE_EL = "(\"workspace-el\");";
	private static final String LAYER_CONTAINER_BODY = "layer-container-body";

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private ProjectPropertiesService projectPropertiesService;
	
	@Autowired
	private BingMapService bingMapService;

	private final Vector<RemoteWebDriver> drivers = new Vector<RemoteWebDriver>();
	private final Logger logger = LoggerFactory.getLogger(BrowserService.class);
	private static final String KML_FOR_GEE_JS = "resources/javascript_gee.fmt";
	private static final Configuration cfg = new Configuration();
	private static Template template;

	private RemoteWebDriver webDriverEE, webDriverBing, webDriverTimelapse;

	private static boolean hasCheckValidity = false;

	
	@Override
	protected void finalize() throws Throwable {
		super.finalize();
		closeBrowsers();
	}

	public void closeBrowsers() {
		getClosingBrowsersThread().start();
	}
	
	public void attachShutDownHook() {
		Runtime.getRuntime().addShutdownHook(
				getClosingBrowsersThread()
		);
	}

	private RemoteWebDriver chooseDriver() {
		RemoteWebDriver driver = null;
		final String chosenBrowser = localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE);

		if (chosenBrowser != null && chosenBrowser.trim().toLowerCase().equals(EarthConstants.CHROME_BROWSER)) {
			driver = startChromeBrowser(driver);
		} else {
			driver = startFirefoxBrowser(driver);
		}

		return driver;

	}

	private String getCompleteGeeJS() throws IOException {
		BufferedReader in = null;
		final StringBuffer jsResult = new StringBuffer();
		try {
			final URL geeJsUrl = new URL(localPropertiesService.getValue(EarthProperty.GEE_JS_LIBRARY_URL));

			// Start Work-around so that we can connect to an HTTPS server without needing to include the certificate
			final SSLContext ssl = SSLContext.getInstance("TLSv1");
			ssl.init(null, new TrustManager[] { new TrustAllCertificates() }, null);
			final SSLSocketFactory factory = ssl.getSocketFactory();
			final HttpsURLConnection connection = (HttpsURLConnection) geeJsUrl.openConnection();
			connection.setSSLSocketFactory(factory);

			connection.setHostnameVerifier(new HostnameVerifier() {
				@Override
				public boolean verify(String hostname, SSLSession session) {
					return true;
				}
			});
			// End or work-around

			in = new BufferedReader(new InputStreamReader(connection.getInputStream()));
			String inputLine;
			while ((inputLine = in.readLine()) != null) {
				jsResult.append(inputLine);
			}
			in.close();
		} catch (final Exception e) {
			logger.error("Not possible to read URI " + localPropertiesService.getValue(EarthProperty.GEE_JS_LIBRARY_URL), e);
			return null;
		} finally {
			if (in != null) {
				in.close();
			}
		}

		return jsResult.toString();
	}

	private String getGEEJavascript(String[] latLong) {

		final Map<String, String> data = new HashMap<String, String>();
		data.put("latitude", latLong[0]);
		data.put("longitude", latLong[1]);
		data.put(EarthProperty.GEE_FUNCTION_PICK.toString(), localPropertiesService.getValue(EarthProperty.GEE_FUNCTION_PICK));
		data.put(EarthProperty.GEE_ZOOM_OBJECT.toString(), localPropertiesService.getValue(EarthProperty.GEE_ZOOM_OBJECT));
		data.put(EarthProperty.GEE_ZOOM_METHOD.toString(), localPropertiesService.getValue(EarthProperty.GEE_ZOOM_METHOD));
		data.put(EarthProperty.GEE_INITIAL_ZOOM.toString(), localPropertiesService.getValue(EarthProperty.GEE_INITIAL_ZOOM));
		
		StringWriter fw = null;
		Writer out = null;
		try {
			if (template == null) {
				// Load template from source folder
				template = cfg.getTemplate(KML_FOR_GEE_JS);
			}
			// Console output
			fw = new StringWriter();
			out = new BufferedWriter(fw);

			// Add date to avoid caching
			template.process(data, out);

		} catch (final TemplateException e) {
			logger.error("Error when generating the GEE javascript commands", e);
		} catch (final IOException e) {
			logger.error("Error when reading/writing the template information", e);
		} finally {
			try {
				if (out != null) {
					out.flush();
				}
				if (fw != null) {
					fw.close();
				}
			} catch (final IOException e) {
				logger.error("Error when closing the output streams", e);
			}
		}

		return fw != null ? fw.toString() : null;

	}

	private RemoteWebDriver initBrowser() {
		RemoteWebDriver driver = null;
		try {
			driver = chooseDriver();
			drivers.add(driver);
		} catch (final Exception e) {
			logger.error("Problems starting chosen browser", e);
		}
		return driver;
	}

	private boolean isGEEValidJS(String geeJs, RemoteWebDriver driver) {

		boolean stillValid = false;

		try {

			geeJs = geeJs.substring(0, geeJs.indexOf("focusObject."));
			((JavascriptExecutor) driver).executeScript(geeJs);

			stillValid = true;
		} catch (final Exception e) {
			processSeleniumError(e);
		}

		return stillValid;
	}

	private boolean isIdOrNamePresent(String elementId, RemoteWebDriver driver) {
		boolean found = false;

		try {
			if (driver.findElementById(elementId).isDisplayed() || driver.findElementByName(elementId).isDisplayed()) {
				found = true;
			}
			logger.debug("Found " + elementId);
		} catch (final Exception e) {
			logger.debug("Not Found " + elementId);
		}

		return found;
	}
	
	private boolean isXPathPresent(String xpath, RemoteWebDriver driver) {
		boolean found = false;

		try {
			if (driver.findElementByXPath(xpath).isDisplayed() ) {
				found = true;
			}
			logger.debug("Found " + xpath);
		} catch (final Exception e) {
			logger.debug("Not Found " + xpath);
		}

		return found;
	}

	private RemoteWebDriver loadLayers(String[] latLong, RemoteWebDriver driver) throws InterruptedException {

		if (driver != null) {
			if (!isIdOrNamePresent("workspace-el", driver)) {
				final String[] layers = {
				// "http://earthengine.google.org/#detail/LANDSAT%2FL7_L1T_ANNUAL_GREENEST_TOA"
				// "http://earthengine.google.org/#detail/LANDSAT%2FL5_L1T_ANNUAL_GREENEST_TOA",
				"https://earthengine.google.org/#detail/LANDSAT%2FLC8_L1T_ANNUAL_GREENEST_TOA" };
				for (final String urlForLayer : layers) {
					driver = navigateTo(urlForLayer, driver);
					if (waitForXPath("//*[@id=\"detail-el\"]/div[2]/div[1]", driver)) {
						driver.findElementByXPath("//*[@id=\"detail-el\"]/div[2]/div[1]").click();
						waitFor("workspace-el", driver);
					}
				}
			}
			if (waitFor("workspace-el", driver)) {
				if (driver instanceof JavascriptExecutor) {
					try {
						String geeJs = getGEEJavascript(latLong);
						if (!hasCheckValidity) {
							try {
								if (!isGEEValidJS(geeJs, driver)) {
									refreshJSValues(geeJs, driver);
									geeJs = getGEEJavascript(latLong);
								}
							} catch (final Exception e) {
								logger.error("Error checking the validity of the GEE js code", e);
							} finally {
								hasCheckValidity = true;
							}
						}
						((JavascriptExecutor) driver).executeScript(geeJs);
					} catch (final Exception e) {
						processSeleniumError(e);
					}
					Thread.sleep(1000);
					final List<WebElement> dataLayerVisibility = driver.findElementsByClassName("indicator");
					for (final WebElement webElement : dataLayerVisibility) {
						if (webElement.isDisplayed()) {
							webElement.click();
							Thread.sleep(1000);
							webElement.click();
						}
					}
				}
			}
		}
		return driver;
	}

	private void processSeleniumError(final Exception e) {
		if( e.getCause()!=null && e.getCause().getMessage()!=null && !e.getCause().getMessage().contains("latitude") ){
			logger.error("Error in the selenium driver", e);
		}else{
			logger.info("Error in the selenium driver provoked by known bug", e);
		}
	}
	
	public synchronized RemoteWebDriver navigateTo(String url, RemoteWebDriver driver ) {
		return navigateTo(url, driver, true);
	}

	/**
	 * Loads the given URL into the browser. If the browser is null then a new browser window is open.
	 * @param url The URL to load.
	 * @param driver The browser window to use. If this value is null a new browser window is open.
	 * @return THe browser window (firefox or chrome depending on the configuration) used to open the URL.
	 */
	public synchronized RemoteWebDriver navigateTo(String url, RemoteWebDriver driver, boolean retry ) {

		if (driver == null) {
			driver = initBrowser();
		}
		if (driver != null) {
			try {
				driver.navigate().to(url);
			} catch (final Exception e) {
				if( retry && ( e.getCause()!=null &&  e.getCause().getMessage()!=null && e.getCause().getMessage().contains("Session not found") || e instanceof UnreachableBrowserException ) ){
					// Browser closed, restart it!
					logger.error("Browser was closed, restaring it...", e);
					driver = initBrowser();
					navigateTo(url, driver, false ); // only try to re-open one
				}
			}
		}
		return driver;
	}

	/**
	 * Opens a browser window with the Bing Maps representation of th eplot.
	 * @param coordinates The center point of the plot.
	 * 
	 */
	public synchronized void openBingMaps(String coordinates) {

		if (projectPropertiesService.isBingMapsSupported()) {

			if (webDriverBing == null) {
				webDriverBing = initBrowser();
			}

			final RemoteWebDriver driverCopy = webDriverBing;
			final String[] latLong = coordinates.split(",");
			final Thread loadBingThread = new Thread() {
				@Override
				public void run() {

					try {
						webDriverBing = navigateTo(bingMapService.getTemporaryUrl(latLong), driverCopy);
					} catch (final Exception e) {
						logger.error("Problems loading Bing", e);
					}

				};
			};

			loadBingThread.start();
		}
	}

	/**
	 * Opens a browser window with the Google Earth Engine representation of the plot. The Landsat 8 Annual Greenest pixel TOA for 2013 is loaded automatically. 
	 * @param coordinates The center point of the plot.
	 * 
	 */
	public synchronized void openEarthEngine(String coordinates) {

		logger.warn("Starting to open EE - supported : " + projectPropertiesService.isEarthEngineSupported()   );
		if (projectPropertiesService.isEarthEngineSupported()) {

			if (webDriverEE == null) {
				webDriverEE = initBrowser();
			}

			final String[] latLong = coordinates.split(",");

			final RemoteWebDriver driverCopy = webDriverEE;
			final Thread loadEEThread = new Thread() {
				@Override
				public void run() {
					try {
						logger.warn("Loading layers - " + Arrays.toString(latLong)   );
						webDriverEE = loadLayers(latLong, driverCopy);
					} catch (final Exception e) {
						logger.error("Error when opening Earth Engine browser window", e);
					}
				};
			};
			loadEEThread.start();
		}
	}

	/**
	 * Opens a browser window with the Google Earth Engine Timelapse representation of the plot. 
	 * @param coordinates The center point of the plot.
	 * 
	 */
	public synchronized void openTimelapse(final String coordinates) {

		if (projectPropertiesService.isTimelapseSupported()) {

			if (webDriverTimelapse == null) {
				webDriverTimelapse = initBrowser();
			}

			final RemoteWebDriver driverCopy = webDriverTimelapse;
			final Thread loadTimelapseThread = new Thread() {
				@Override
				public void run() {

					try {
						webDriverTimelapse = navigateTo("https://earthengine.google.org/#timelapse/v=" + coordinates + ",10.812,latLng&t=0.08",
								driverCopy);
					} catch (final Exception e) {
						logger.error("Problems loading Timelapse", e);
					}

				};
			};
			loadTimelapseThread.start();
		}
	};

	private void refreshJSValues(String geeJs, RemoteWebDriver driver) throws IOException {
		final String jsGee = getCompleteGeeJS();
		if (jsGee != null && jsGee.length() > 0) {
			// try to find this pattern for the gee_js_pickFunction value ("workspace-el"); " var b=H("workspace-el"); "
			final int indexWorkspaceEL = jsGee.indexOf(WORKSPACE_EL);
			int startEquals = 0;
			for (startEquals = indexWorkspaceEL; startEquals > indexWorkspaceEL - 20; startEquals--) {
				if (jsGee.charAt(startEquals) == '=') {
					break;
				}
			}
			final String pickFunction = jsGee.substring(startEquals + 1, indexWorkspaceEL).trim();

			// try to find this pattern for the gee_js_zoom_object value Mt G(g,"layer-container-body");a.na=new Mt(c,b);f.V(a.na,
			final int indexLayer = jsGee.indexOf(LAYER_CONTAINER_BODY, startEquals);
			final int indexEqual = jsGee.indexOf(NEW, indexLayer);
			final int indexParenthesis = jsGee.indexOf('(', indexEqual);

			final String zoomObject = jsGee.substring(indexEqual + NEW.length(), indexParenthesis).trim();

			// try to find this pattern for the gee_js_zoom_function value Mt Mt.prototype.I=function(a){if(ja(a)){Qt(this);var b=a.viewport;if(b){var
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

	private RemoteWebDriver startChromeBrowser(RemoteWebDriver driver) {

		final Properties props = System.getProperties();
		if (props.getProperty("webdriver.chrome.driver") == null) {
			if( SystemUtils.IS_OS_UNIX ){
				props.setProperty("webdriver.chrome.driver", "resources/chromedriver");
			}else if( SystemUtils.IS_OS_WINDOWS ){
				props.setProperty("webdriver.chrome.driver", "resources/chromedriver.exe");
			}else{
				throw new RuntimeException("Chromedriver is not supported in the current OS" );
			}
		}

		final String chromeBinaryPath = localPropertiesService.getValue(EarthProperty.CHROME_BINARY_PATH);
		if (chromeBinaryPath != null && chromeBinaryPath.trim().length() > 0) {
			try {
				final DesiredCapabilities capabilities = DesiredCapabilities.chrome();
				capabilities.setCapability("chrome.binary", chromeBinaryPath);
				driver = new ChromeDriver(capabilities);
			} catch (final WebDriverException e) {
				logger.error("The chrome executable chrome.exe cannot be found, please edit earth.properties and correct the chrome.exe location at "
						+ EarthProperty.CHROME_BINARY_PATH + " pointing to the full path to chrome.exe", e);
			}
		} else {
			try {
				driver = new ChromeDriver();
			} catch (final WebDriverException e) {
				logger.error("The chrome executable chrome.exe cannot be found, please edit earth.properties and add the chrome.exe location in "
						+ EarthProperty.CHROME_BINARY_PATH + " pointing to the full path to chrome.exe", e);
			}
		}
		return driver;
	}

	private RemoteWebDriver startFirefoxBrowser(RemoteWebDriver driver) {
		final FirefoxProfile ffprofile = new FirefoxProfile();
		FirefoxBinary firefoxBinary = null;

		final String firefoxBinaryPath = localPropertiesService.getValue(EarthProperty.FIREFOX_BINARY_PATH);

		if (firefoxBinaryPath != null && firefoxBinaryPath.trim().length() > 0) {
			try {
				firefoxBinary = new FirefoxBinary(new File(firefoxBinaryPath));
				driver = new FirefoxDriver(firefoxBinary, ffprofile);
			} catch (final WebDriverException e) {
				logger.error(
						"The firefox executable firefox.exe cannot be found, please edit earth.properties and correct the firefox.exe location at "
								+ EarthProperty.FIREFOX_BINARY_PATH + " pointing to the full path to firefox.exe", e);
			}
		} else {
			// Try with default Firefox executable
			try {
				firefoxBinary = new FirefoxBinary();
				driver = new FirefoxDriver(firefoxBinary, ffprofile);
			} catch (final WebDriverException e) {
				logger.error("The firefox executable firefox.exe cannot be found, please edit earth.properties and add a line with the property "
						+ EarthProperty.FIREFOX_BINARY_PATH + " pointing to the full path to firefox.exe", e);
			}
		}
		return driver;
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
			if (i > 30) {
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
		return new Thread() {
			@Override
			public void run() {
				for (final RemoteWebDriver driver : drivers) {
					try {
						driver.quit();
					} catch (final Exception e) {
						logger.error("Error quitting the browser", e);
					}
				}
			}
		};
	}

	@Override
	public void update(Observable o, Object arg) {
		if( arg == ServerController.SERVER_STOPPED_EVENT ){
			this.closeBrowsers();
		}
	}
}
