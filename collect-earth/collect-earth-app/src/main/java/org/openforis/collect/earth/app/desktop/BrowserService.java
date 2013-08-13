package org.openforis.collect.earth.app.desktop;

import java.util.List;

import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxProfile;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class BrowserService {

	private RemoteWebDriver driver;

	private final Logger logger = LoggerFactory.getLogger(BrowserService.class);

	public void openBrowser(String coordinates) {
		try {
			String[] latLong = coordinates.split(",");
			if (driver == null) {
				initBrowser();
			}
			loadLayers(getExtraJavascript(latLong));
		} catch (InterruptedException e) {
			logger.error("Error when opening browser window", e);
		}
		

		// driver.navigate().to("https://maps.google.com/?ll=" + latLong[1] +
		// "," + latLong[0] + "&spn=0.16423,0.41851&t=h&z=12");
	}

	private String getExtraJavascript(String[] latLong) {

		String jsonObject = ""
				+ "var c=new google.maps.Map("
				+ "	H(\"map\"),{center:new google.maps.LatLng(0,0),zoom:2,mapTypeId:google.maps.MapTypeId.SATELLITE,panControl:!1,streetViewControl:!1,scaleControl:!0,scrollwheel:!0,zoomControlOptions:{position:google.maps.ControlPosition.RIGHT_TOP,style:google.maps.ZoomControlStyle.LARGE}});"
				+ ""
				+ "var b=H(\"workspace-el\"); "
				+ ""
				+ "var jsonObject = { \"viewport\":{ "
				+ "\"zoom\":10,"
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

		return (jsonObject + " var pa=new Pu(c,b); pa.J(jsonObject);");

	}

	private void loadLayers(String executeJavascript) throws InterruptedException {
		if (!isIdPresent("workspace-el")) {
			driver.navigate().to("http://earthengine.google.org/#detail/LANDSAT%2FL5_L1T_ANNUAL_GREENEST_TOA");
			waitFor("d_open_button");
			driver.findElementById("d_open_button").click();
			waitFor("workspace-el");
		}

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

	private boolean isIdPresent(String elementId) {
		boolean found = false;

		try {
			if (driver.findElementById(elementId).isDisplayed()) {
				found = true;
				System.out.println("Found " + elementId);
			} else {
				System.out.println("Found but not displayed" + elementId);
			}

		} catch (Exception e) {
			System.out.println("Not Found " + elementId);
		}

		return found;
	}

	public void waitFor(String elementId ) {
		int i =0;
		while (!isIdPresent(elementId)) {
			try {
				Thread.sleep(1000);
			} catch (InterruptedException e) {
				return;
			}
			i++;
			if (i > 30) {
				return;
			}
		}
	};

	private RemoteWebDriver initBrowser() {
		// https://maps.google.com/?ll=42.940339,-115.092773&spn=13.360955,33.815918&t=h&z=6
		FirefoxProfile ffprofile = new FirefoxProfile();
		// ffprofile.setPreference(); //Set your preference here
		driver = new FirefoxDriver(ffprofile);
		return driver;
	}

	public static void main(String[] args) {
		try {
			BrowserService bs = new BrowserService();
			bs.openBrowser("44,55");
		} catch (Exception e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		} finally {
			System.exit(0);
		}
	}
}
