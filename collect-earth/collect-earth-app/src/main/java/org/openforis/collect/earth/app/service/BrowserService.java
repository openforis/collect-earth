package org.openforis.collect.earth.app.service;

import java.awt.Toolkit;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.StringSelection;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.StringWriter;
import java.io.Writer;
import java.net.URL;
import java.security.Security;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Observable;
import java.util.Observer;
import java.util.Properties;
import java.util.Vector;
import java.util.zip.GZIPInputStream;

import javax.annotation.PostConstruct;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import liquibase.util.SystemUtils;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController.ServerInitializationEvent;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.firefox.FirefoxBinary;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxProfile;
import org.openqa.selenium.remote.DesiredCapabilities;
import org.openqa.selenium.remote.RemoteWebDriver;
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
	private GeolocalizeMapService geoLocalizeTemplateService;

	private final Vector<RemoteWebDriver> drivers = new Vector<RemoteWebDriver>();
	private final Logger logger = LoggerFactory.getLogger(BrowserService.class);
	private static final String KML_FOR_GEE_JS = "resources/javascript_gee.fmt";
	private static final Configuration cfg = new Configuration();
	private static Template template;

	private RemoteWebDriver webDriverEE, webDriverBing, webDriverTimelapse, webDriverGeePlayground, webDriverHere;

	private static boolean geeMethodUpdated = false;


	public void closeBrowsers() {
		synchronized (this) {
			getClosingBrowsersThread().start();
		}
		
	}
	
	@PostConstruct
	public void attachShutDownHook() {
		Runtime.getRuntime().addShutdownHook(
				getClosingBrowsersThread()
		);
	}

	private RemoteWebDriver chooseDriver() throws BrowserNotFoundException{
		RemoteWebDriver driver = null;
		final String browserSetInProperties = localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE);
		final String browserThatExists = checkIfBrowserIsInstalled(browserSetInProperties);

		try {
			if (browserThatExists != null && browserThatExists.trim().toLowerCase().equals(EarthConstants.CHROME_BROWSER.toLowerCase())) {
					driver = startChromeBrowser(driver);
			} else {
				driver = startFirefoxBrowser(driver);
			}
		} catch (final WebDriverException e) {
			logger.warn("The chrome executable chrome.exe cannot be found, please edit earth.properties and add the chrome.exe location in "
					+ EarthProperty.CHROME_BINARY_PATH + " pointing to the full path to chrome.exe", e);
			// The user chose Chrome, but Chrome could not be found
			if( browserSetInProperties.equals(browserThatExists ) ){
				throw new BrowserNotFoundException("Chrome could not be found");
			}else{ // THe user chose Firefox, it was not found then it tried Chrome and it was not found either, no browser has been installed 
				throw new BrowserNotFoundException("Neither Chrome nor Firefox is installed. You need to have one of them installed in order to use GEE, Bing Maps or Saiku.", e);
			}
			
		}

		return driver;
	}

	private String checkIfBrowserIsInstalled(String chosenBrowser) {
		if( chosenBrowser.equals( EarthConstants.FIREFOX_BROWSER ) ){
			if( StringUtils.isBlank( localPropertiesService.getValue(EarthProperty.FIREFOX_BINARY_PATH) ) ){
				FirefoxLocatorFixed firefoxLocator = new FirefoxLocatorFixed();
				try {
					firefoxLocator.findBrowserLocationOrFail();
				} catch (Exception e) {
					logger.warn("Could not find firefox browser, switching to Chrome ", e);
					chosenBrowser = EarthConstants.CHROME_BROWSER;
				}
			}			
		}
		return chosenBrowser;
	}

	private String getCompleteGeeJS() throws IOException {
		BufferedReader in = null;
		final StringBuffer jsResult = new StringBuffer();
		try {
			final URL geeJsUrl = new URL(localPropertiesService.getValue(EarthProperty.GEE_JS_LIBRARY_URL));

			// Start Work-around so that we can connect to an HTTPS server without needing to include the certificate
			Security.getProviders();
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

			if (connection.getHeaderField("Content-Encoding")!=null && connection.getHeaderField("Content-Encoding").equals("gzip")){
	            in = new BufferedReader(new InputStreamReader(new GZIPInputStream(connection.getInputStream())));            
	        } else {
	            in = new BufferedReader(new InputStreamReader(connection.getInputStream()));            
	        }     
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

		//final Map<String, String> data = new HashMap<String, String>();
		final Map<String,Object> data = geoLocalizeTemplateService.getPlacemarkData(latLong);
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

	private RemoteWebDriver initBrowser() throws BrowserNotFoundException  {
		RemoteWebDriver driver = null;
		driver = chooseDriver();
		//minimizeWindow(driver);
		drivers.add(driver);
		return driver;
	}

/*	private void minimizeWindow(RemoteWebDriver driver) {
		try {		
			String minimize = Keys.chord(Keys.ALT,Keys.SPACE, "n");
			driver.getKeyboard().sendKeys(minimize);
		} catch (Exception e) {
			logger.error("Error minimizing", e);
		}
	}*/
	
	/*private boolean isGEEValidJS(String geeJs, RemoteWebDriver driver) {

		boolean stillValid = false;

		try {

			geeJs = geeJs.substring(0, geeJs.indexOf("focusObject."));
			((JavascriptExecutor) driver).executeScript(geeJs);

			stillValid = true;
		} catch (final Exception e) {
			processSeleniumError(e);
		}

		return stillValid;
	}*/

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

	private RemoteWebDriver loadLayers(String[] latLong, RemoteWebDriver driver) throws InterruptedException, BrowserNotFoundException {

		if (driver != null) {
/*			if (!isIdOrNamePresent("workspace-el", driver)) {
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
			} */
			
			if (!isIdOrNamePresent("workspace-el", driver)) {
				driver = navigateTo("https://earthengine.google.org/#workspace", driver);
			}
			
			if (waitFor("workspace-el", driver)) {
				if (driver instanceof JavascriptExecutor) {
					try {
						String geeJs = getGEEJavascript(latLong);
						if (!isGeeMethodUpdated()) {
							try {
								// REFRESH EVERY TIME!!!
								// if (!isGEEValidJS(geeJs, driver)) {
									refreshJSValues(geeJs, driver);
									geeJs = getGEEJavascript(latLong);
								//}
							} catch (final Exception e) {
								logger.error("Error checking the validity of the GEE js code", e);
							} finally {
								setGeeMethodUpdated(true);
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

	public static boolean isGeeMethodUpdated() {
		return geeMethodUpdated;
	}

	public static void setGeeMethodUpdated(boolean geeMethosUpdated) {
		BrowserService.geeMethodUpdated = geeMethosUpdated;
	}

	private void processSeleniumError(final Exception e) {
		if( e.getCause()!=null && e.getCause().getMessage()!=null && !e.getCause().getMessage().contains("latitude") ){
			logger.warn("Error in the selenium driver", e);
		}else{
			logger.info("Error in the selenium driver provoked by known bug", e);
		}
	}
	
	public RemoteWebDriver navigateTo(String url, RemoteWebDriver driver ) throws BrowserNotFoundException {
		return navigateTo(url, driver, true);
	}

	/**
	 * Loads the given URL into the browser. If the browser is null then a new browser window is open.
	 * @param url The URL to load.
	 * @param driver The browser window to use. If this value is null a new browser window is open.
	 * @param retry Specify if there should be a second try to open a browser window if the first time fails (useful if the browser could not be found)
	 * @return THe browser window (firefox or chrome depending on the configuration) used to open the URL.
	 * @throws BrowserNotFoundException Exception thrown when there is no Firefox/Chrome installed
	 */
	public RemoteWebDriver navigateTo(String url, RemoteWebDriver driver, boolean retry ) throws BrowserNotFoundException {

		if (driver == null || !isDriverWorking(driver) ) {
			driver = initBrowser();
		}
		
		
		if (driver != null) {
			try {
				driver.navigate().to(url);
			} catch (final Exception e) {
				if( retry && ( e.getCause()!=null &&  e.getCause().getMessage()!=null && e.getCause().getMessage().contains("Session not found") ) ){
					// Browser closed, restart it!
					logger.error("Browser was closed, restaring it...", e);
					driver = initBrowser();
					navigateTo(url, driver, false ); // only try to re-open one
				}
			}
		}else{
			logger.error("No Selenium driver available, Is Firefox or Chrome installed?");
		}
		return driver;
	}

	private boolean isDriverWorking(RemoteWebDriver driver) {
		boolean stillWorking = true;
		try {
			driver.findElement(By.xpath("//body"));
		} catch (Exception e) {
			stillWorking = false;
		}
		return stillWorking;
	}

	/**
	 * Opens a browser window with the Bing Maps representation of th eplot.
	 * @param coordinates The center point of the plot.
	 * @throws BrowserNotFoundException In case the browser could not be found
	 * 
	 */
	public void openBingMaps(String coordinates) throws BrowserNotFoundException {

		if (localPropertiesService.isBingMapsSupported()) {

			if (webDriverBing == null) {
				webDriverBing = initBrowser();
			}

			final RemoteWebDriver driverCopy = webDriverBing;
			final String[] latLong = coordinates.split(",");
			final Thread loadBingThread = new Thread() {
				@Override
				public void run() {
					try {
						webDriverBing = navigateTo(geoLocalizeTemplateService.getBingUrl(latLong,  localPropertiesService.getValue( EarthProperty.BING_MAPS_KEY), GeolocalizeMapService.FREEMARKER_BING_HTML_TEMPLATE).toString(), driverCopy);
					} catch (final Exception e) {
						logger.error("Problems loading Bing", e);
					}
				};
			};
			
			loadBingThread.start();
			
		}
	}
	
	/**
	 * Opens a browser window with the Here Maps representation of the plot.
	 * @param coordinates The center point of the plot.
	 * @throws BrowserNotFoundException In case the browser could not be found
	 * 
	 */
	public void openHereMaps(String coordinates) throws BrowserNotFoundException {

		if (localPropertiesService.isHereMapsSupported()) {

			if (webDriverHere == null) {
				webDriverHere = initBrowser();
			}

			final RemoteWebDriver driverCopy = webDriverHere;
			final String[] centerPlotLocation = coordinates.split(",");
			final Thread loadHereThread = new Thread() {
				@Override
				public void run() {
					try {
						webDriverHere = navigateTo(geoLocalizeTemplateService.getHereUrl(centerPlotLocation, localPropertiesService.getValue( EarthProperty.HERE_MAPS_APP_ID), localPropertiesService.getValue( EarthProperty.HERE_MAPS_APP_CODE), GeolocalizeMapService.FREEMARKER_HERE_HTML_TEMPLATE).toString(), driverCopy);
					} catch (final Exception e) {
						logger.error("Problems loading Here Maps", e);
					}
				};
			};
			
			loadHereThread.start();
			
		}
	}


	private void paste(WebElement textarea, WebDriver webDriver, String jsGeeText) {
	    JavascriptExecutor js = (JavascriptExecutor ) webDriver;
	    js.executeScript("arguments[0].value='arguments[1]'", textarea, jsGeeText );

	}
	
	
	/**
	 * Opens a browser window with the Google Earth Engine Playground and runs the freemarker template found in resources/eePlaygroundScript.fmt on the main editor of GEE. 
	 * @param coordinates The center point of the plot.
	 * @throws BrowserNotFoundException If the browser cannot be found
	 * 
	 */
	public void openGeePlayground(String coordinates) throws BrowserNotFoundException {

		if (localPropertiesService.isGeePlaygroundSupported()) {

			if (webDriverGeePlayground == null) {
				webDriverGeePlayground = initBrowser();
			}

			final String[] latLong = coordinates.split(",");

			final Thread loadEEThread = new Thread() {
				@Override
				public void run() {
					try {
						URL fileWithScript = geoLocalizeTemplateService.getTemporaryUrl(latLong, getGeePlaygroundTemplate());
						
						if (!isIdOrNamePresent("main", webDriverGeePlayground)) {
							webDriverGeePlayground = navigateTo( localPropertiesService.getGeePlaygoundUrl(), webDriverGeePlayground);
						}
						
						webDriverGeePlayground.findElementByCssSelector("button.goog-button:nth-child(5)").click();
						
						WebElement textArea = webDriverGeePlayground.findElement(By.className("ace_text-input"));
						
						
						if( SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX){
						    // Command key (apple key) is not working on Chrome on Mac. Try with the right clik
							// This is not going to be fixed by Selenium
							// Try adifferent approach! A bit slower but works
							String contents =  FileUtils.readFileToString( new File(fileWithScript.toURI())) ;
							// Remove comments so it is faster to send the text!
							String noComments = removeComments(contents); 		
							// Clear the code area
							webDriverGeePlayground.findElementByCssSelector("div.goog-inline-block.goog-flat-menu-button.custom-reset-button").click();
							webDriverGeePlayground.findElementByXPath("//*[contains(text(), 'Clear script')]").click();
							// Send the content of the script
							textArea.sendKeys( noComments );
							// Fix the extra characters added by removing the last 10 chars ( this is a bug from Selenium! )
							textArea.sendKeys(Keys.PAGE_DOWN);
							for( int i=0; i<10; i++){
								textArea.sendKeys(Keys.BACK_SPACE);
							}
							
						}else{
							Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
							String contents = FileUtils.readFileToString( new File(fileWithScript.toURI()));
							StringSelection clipboardtext = new StringSelection( contents );
							clipboard.setContents(clipboardtext, null);
							textArea.sendKeys(Keys.chord(Keys.CONTROL,"a"));
							textArea.sendKeys(Keys.chord(Keys.CONTROL,"v"));
						}
						
						
						//((JavascriptExecutor)webDriverGeePlayground).executeScript("arguments[0].value = arguments[1];", textArea,);
						Thread.sleep(1000);
						webDriverGeePlayground.findElementByCssSelector("button.goog-button.run-button").click();
						
					} catch (final NoSuchElementException e) {
						// This is a well known exception. Down-grade if to warning
						logger.warn("Error when opening Earth Engine browser window. Known problem", e);
					} catch (final Exception e) {
						// This is a well known exception. 
						logger.error("Error when opening Earth Engine browser window", e);
					}
				}

				public String removeComments(String contents) {
					String noComments = "";
					int indexComments = contents.indexOf("//");
					if( indexComments != -1 ){
						while( indexComments >= 0){
							int endOfLine = contents.indexOf("\r\n", indexComments);		
							if( endOfLine != -1 )
								indexComments = contents.indexOf("//", endOfLine+2 );
							else{
								indexComments = -1;
								break;
							}
							
							if( indexComments != -1 )
								noComments += contents.substring( endOfLine, indexComments );
							else
								noComments += contents.substring( endOfLine);
						}
					}else
						noComments = contents;
					return noComments;
				}

				/**
				 * Get the GEE Playground script that should be used.
				 * There is an standard one that resides in resources/eePlaygroundScript.fmt but a project might have its own script.
				 * 
				 * @return The generic script in the resources folder or the file called eePlaygroundScript.fmt in hte same folder where the current project file resides
				 */
				private String getGeePlaygroundTemplate() {

					String projectPlaygroundScript = getProjectGeeScript();
					if( projectPlaygroundScript != null  ){
						return projectPlaygroundScript;
					}else{
						return GeolocalizeMapService.FREEMARKER_GEE_PLAYGROUND_TEMPLATE;
					}
					
				};
			};
			loadEEThread.start();
		}
	}
	
	/**
	 * Find the GEE playground script that should be used for the project that is currently loaded in Collect Earth
	 * @return The path to the GEE playground generic script or the one that is specified in the project folder if it exists. 
	 */
	private String getProjectGeeScript() {
		// Where the metatadata file (usually placemark.idm.xml ) is located
		
		// Is there a "eePlaygroundScript.fmt" file in the same folder than in the metadata file folder?
		File projectGeePlayground = new File( localPropertiesService.getProjectFolder() + File.separatorChar + GeolocalizeMapService.FREEMARKER_GEE_PLAYGROUND_TEMPLATE_FILE_NAME);
		
		String geePlaygroundFilePath = null;
		if( projectGeePlayground.exists() ){
			geePlaygroundFilePath = projectGeePlayground.getAbsolutePath();
		}
		return geePlaygroundFilePath;
	}
	
	/**
	 * Opens a browser window with the Google Earth Engine representation of the plot. The Landsat 8 Annual Greenest pixel TOA for 2013 is loaded automatically. 
	 * @param coordinates The center point of the plot.
	 * @throws BrowserNotFoundException If the browser cannot be found
	 * 
	 */
	public void openEarthEngine(String coordinates) throws BrowserNotFoundException {

		logger.warn("Starting to open EE - supported : " + localPropertiesService.isEarthEngineSupported()   );
		if (localPropertiesService.isEarthEngineSupported()) {

			if (webDriverEE == null) {
				setGeeMethodUpdated(false); // Force the method to find the GEE specific methods again
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
	 * @throws BrowserNotFoundException If the browser cannot be found
	 * 
	 */
	public void openTimelapse(final String coordinates) throws BrowserNotFoundException {

		if (localPropertiesService.isTimelapseSupported()) {

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
			// New one : var a=F("workspace-el");N(a,!0);N(F("savebox"),!0);if(!this.ya){var e=new google.maps.Map(F("map"),
			
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
			if( SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX){
				props.setProperty("webdriver.chrome.driver", "resources/chromedriver_mac");
			}else if( SystemUtils.IS_OS_UNIX ){
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
			driver = new ChromeDriver();			
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
				FirefoxLocatorFixed flf = new FirefoxLocatorFixed();
				String launcherFilePath = flf.findBrowserLocationFix().launcherFilePath();
				firefoxBinary = new FirefoxBinary( new File( launcherFilePath ) );
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
		if( ServerInitializationEvent.SERVER_STOPPED_EVENT.equals(arg) ){
			this.closeBrowsers();
		}
	}
}

