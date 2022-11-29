package org.openforis.collect.earth.app.service;

import java.io.File;

import org.apache.commons.lang3.SystemUtils;


public class FirefoxLocatorFixed{

	private FirefoxLocatorFixed(){
	}

	public static String tryToFindFolder(){
		String path = null;
		if (SystemUtils.IS_OS_WINDOWS){
			return findInUsualWindowsLocations();
		}else if (SystemUtils.IS_OS_MAC){
			return findInUsualMacLocations();
		}

		return path;		  
	}

	/**
	 * Dynamic because the directory version number keep changing.
	 */
	private  static String findInUsualMacLocations() {

		String[] localAppDataLocations = new String[]{
				FolderFinder.getLocalAppDataFolder() + "/Applications/Firefox.app/Contents/MacOS/firefox-bin" ,
				FolderFinder.getLocalAppDataFolder() + "/Applications/Mozilla Firefox.app/Contents/MacOS/firefox-bin"
		};

		for (String path : localAppDataLocations) {
			File f = new File(path);
			if( f.exists() ){
				return path;
			}

		}

		return null;
	}


	private static String findInUsualWindowsLocations() {

		String[] localAppDataLocations = new String[]{
				FolderFinder.getLocalAppDataFolder() + "\\Firefox-3\\firefox.exe" ,
				FolderFinder.getLocalAppDataFolder() + "\\Mozilla Firefox\\firefox.exe",
				FolderFinder.getLocalAppDataFolder() + "\\Firefox\\firefox.exe"
		};

		for (String path : localAppDataLocations) {
			File f = new File(path);
			if( f.exists() ){
				return path;
			}

		}
		return null;
	}

}
