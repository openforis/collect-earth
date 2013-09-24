package org.openforis.collect.earth.app.desktop;

import java.io.File;
import java.util.List;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.firefox.FirefoxBinary;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxProfile;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.openqa.selenium.remote.UnreachableBrowserException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;

public class BrowserService {

	/*	public static void main(String[] args) {
			try {
				BrowserService bs = new BrowserService();
				LocalPropertiesService mockedProperties = org.mockito.Mockito.mock(LocalPropertiesService.class);
				org.mockito.Mockito.when(mockedProperties.isEarthEngineSupported()).thenReturn(true);

				bs.localPropertiesService = mockedProperties;

				bs.openBrowser("44,55");
				bs.openBrowser("10,4.555");
			} catch (Exception e) {
				// TODO Auto-generated catch block
				e.printStackTrace();
			}
		}
	 */
	@Autowired
	protected LocalPropertiesService localPropertiesService;

	private final Logger logger = LoggerFactory.getLogger(BrowserService.class);


	private String getExtraJavascript(String[] latLong) {

		String jsonObject = ""
				+ "var c=new google.maps.Map("
				+ "	G(\"map\"),{center:new google.maps.LatLng(0,0),zoom:2,mapTypeId:google.maps.MapTypeId.SATELLITE,panControl:!1,streetViewControl:!1,scaleControl:!0,scrollwheel:!0,zoomControlOptions:{position:google.maps.ControlPosition.RIGHT_TOP,style:google.maps.ZoomControlStyle.LARGE}});"
				+ ""
				+ "var b=G(\"workspace-el\"); "
				+ ""
				+ "var jsonObject = { \"viewport\":{ "
				+ "\"zoom\":17,"
				+ "\"lat\":"
				+ latLong[0]
						+ ","
						+ "\"lng\":"
						+ latLong[1]
								+ "},"
								+ "\"name\":\"\",\"regionid\":\"\","
								+ "\"classmodel\":[],"
								+ "\"polylayers\":[],"
								+ "\"datalayers\":[{\"title\":\"Landsat 5 Annual Greenest-Pixel TOA Reflectance Composite\",\"originaltitle\":null,\"overlayvisible\":true,\"vis\":{\"opacity\":0.8,\"bands\":[\"40\",\"30\",\"20\"],\"max\":0.425,\"gamma\":1.2000000000000002},\"layermode\":\"advisory-mode\",\"datatype\":\"temporalcollection\",\"periodstart\":1325376000000,\"periodend\":1356998400000,\"id\":\"LANDSAT/L5_L1T_ANNUAL_GREENEST_TOA\",\"assetid\":\"L5_L1T_ANNUAL_GREENEST_TOA/2012\"}],"
								+ "\"drawnpoints\":[],\"drawnpolys\":[],\"analysis\":null};";

		return (jsonObject + " var pa=new Su(c,b); pa.J(jsonObject);");

	}

	private RemoteWebDriver initBrowser() {
		RemoteWebDriver driver = null;
		try {
			FirefoxProfile ffprofile = new FirefoxProfile();
			FirefoxBinary firefoxBinary = null;
					// ffprofile.setPreference(); //Set your preference here
					String firefoxBinaryPath = localPropertiesService.getValue(LocalPropertiesService.FIREFOX_BINARY_PATH);
			if( firefoxBinaryPath!= null && firefoxBinaryPath.trim().length() > 0  ){
				firefoxBinary = new FirefoxBinary(new File(firefoxBinaryPath));
				driver = new FirefoxDriver(firefoxBinary, ffprofile);
			}else{
				// Try with default Firefox executable
				try {
					firefoxBinary = new FirefoxBinary();
					driver = new FirefoxDriver(firefoxBinary, ffprofile);
				} catch (WebDriverException e) {
					logger.error( "The firefox executable firefox.exe cannot be found, please use edit earth.properties and add a line with the property " +LocalPropertiesService.FIREFOX_BINARY_PATH + " pointing to the full path to this file" , e );
				}

			}


		} catch (Exception e) {
			logger.error("Problems starting Firefox browser", e);
			// ffprofile.setPreference(); //Set your preference here
			driver = new ChromeDriver();
		}
		return driver;
	}

	private boolean isIdPresent(String elementId, RemoteWebDriver driver) {
		boolean found = false;

		try {
			if (driver.findElementById(elementId).isDisplayed()) {
				found = true;
			}
			logger.debug("Found " + elementId);
		} catch (Exception e) {
			logger.debug("Not Found " + elementId);
		}

		return found;
	}

	private void loadLayers(String executeJavascript, RemoteWebDriver driver) throws InterruptedException {
		if( driver != null ){
			if (!isIdPresent("workspace-el", driver)) {
				navigateTo("http://earthengine.google.org/#detail/LANDSAT%2FL5_L1T_ANNUAL_GREENEST_TOA", driver);
				if (waitFor("d_open_button", driver)) {
					driver.findElementById("d_open_button").click();
				}

			}
			if (waitFor("workspace-el", driver)) {
				if (driver instanceof JavascriptExecutor) {
					try {
						((JavascriptExecutor) driver).executeScript(executeJavascript);

					} catch (Exception e) {
						logger.debug("Error in the selenium driver", e);
					}
					Thread.sleep(1000);
					List<WebElement> dataLayerVisibility = driver.findElementsByClassName("indicator");
					for (WebElement webElement : dataLayerVisibility) {
						if (webElement.isDisplayed()) {
							webElement.click();
							Thread.sleep(1000);
							webElement.click();
						}
					}
				}
			}
		}
	}

	public synchronized RemoteWebDriver navigateTo(String url, RemoteWebDriver driver) {

		if (driver == null) {
			driver = initBrowser();
		}

		if( driver != null ){
			try {
				driver.navigate().to(url);
			} catch (UnreachableBrowserException e) {
				// Browser closed, restart it!
				driver = initBrowser();
				navigateTo(url, driver);
			}
		}
		return driver;
	};

	public synchronized RemoteWebDriver openBrowser(String coordinates, RemoteWebDriver driver) {

		if (localPropertiesService.isEarthEngineSupported() ) {
			try {
				String[] latLong = coordinates.split(",");
				if (driver == null) {
					driver = initBrowser();
				}
				loadLayers(getExtraJavascript(latLong), driver);
			} catch (InterruptedException e) {
				logger.error("Error when opening browser window", e);
			}

		}
		return driver;
	}

	private boolean waitFor(String elementId, RemoteWebDriver driver) {
		int i = 0;
		while (!isIdPresent(elementId, driver)) {
			try {
				Thread.sleep(1000);
			} catch (InterruptedException e) {
				return false;
			}
			i++;
			if (i > 30) {
				return false;
			}
		}
		return true;
	}
}
