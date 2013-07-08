package org.openforis.collect.earth.app.desktop;

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
				loadLayers();
			}
		} catch (InterruptedException e) {
			logger.error("Error when opening browser window", e);
		}
		

		// driver.navigate().to("https://maps.google.com/?ll=" + latLong[1] +
		// "," + latLong[0] + "&spn=0.16423,0.41851&t=h&z=12");
	}

	private void loadLayers() throws InterruptedException {
		driver.navigate().to("http://earthengine.google.org/#detail/LANDSAT%2FL5_L1T_ANNUAL_GREENEST_TOA");
		
		driver.findElementById("d_open_button").click();
		driver.wait(3000);

		/*
		 * driver.findElementByCssSelector(using)("d_open_button").click();
		 * goog-inline-block goog-flat-menu-button vis-band-red 40
		 * goog-inline-block goog-flat-menu-button vis-band-green 50
		 * goog-inline-block goog-flat-menu-button vis-band-blue 30
		 */
	}

	private RemoteWebDriver initBrowser() {
		// https://maps.google.com/?ll=42.940339,-115.092773&spn=13.360955,33.815918&t=h&z=6
		FirefoxProfile ffprofile = new FirefoxProfile();
		// ffprofile.setPreference(); //Set your preference here
		driver = new FirefoxDriver(ffprofile);
		logger.info("The broser was succesfully initialized");
		return driver;
	}

	public static void main(String[] args) {
		BrowserService bs = new BrowserService();
		bs.openBrowser("44,55");
	}
}
