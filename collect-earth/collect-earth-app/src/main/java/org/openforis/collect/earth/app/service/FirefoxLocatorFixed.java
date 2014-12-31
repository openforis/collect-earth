package org.openforis.collect.earth.app.service;

import org.apache.commons.lang.ArrayUtils;
import org.openqa.selenium.browserlaunchers.locators.BrowserInstallation;
import org.openqa.selenium.browserlaunchers.locators.FirefoxLocator;
import org.openqa.selenium.os.WindowsUtils;

import com.google.common.collect.ImmutableList;

public class FirefoxLocatorFixed extends FirefoxLocator{


	@Override
	protected String[] firefoxDefaultLocationsOnWindows() {

		String[] standardLocations = super.firefoxDefaultLocationsOnWindows();

		String[] localAppDataLocations = new ImmutableList.Builder<String>()
				.add(WindowsUtils.getLocalAppDataPath() + "\\Firefox-3" )
				.add(WindowsUtils.getLocalAppDataPath() + "\\Mozilla Firefox")
				.add(WindowsUtils.getLocalAppDataPath() + "\\Firefox")
				.build().toArray(new String[0]);

		return (String[]) ArrayUtils.addAll(standardLocations, localAppDataLocations );
	}


	public BrowserInstallation findBrowserLocationGrandParent() {
		final BrowserInstallation defaultPath;

		defaultPath = findAtADefaultLocation();
		if (null != defaultPath) {
			return defaultPath;
		}

		return findInPath();
	}

	public BrowserInstallation findBrowserLocationFix() {

		BrowserInstallation findBrowserLocation = findBrowserLocationGrandParent();

		if( findBrowserLocation == null ){
			findBrowserLocation = ( (FirefoxLocator) this) .findBrowserLocation();
		}

		return findBrowserLocation;
	}

	@Override
	public BrowserInstallation findBrowserLocationOrFail() {
		final BrowserInstallation firefoxPathLocation =  findBrowserLocationFix();
		if (null != firefoxPathLocation) {
			return firefoxPathLocation;
		}

		throw new RuntimeException(couldNotFindAnyInstallationMessage());
	}
}
