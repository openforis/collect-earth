package org.openforis.collect.earth.app.service;

import java.io.File;

import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class FolderFinder {

	private static final Logger logger = LoggerFactory.getLogger(FolderFinder.class);

	private FolderFinder(){

	}
	/**
	 * Returns the folder where the backup copies should be placed.
	 * @return The OS dependent folder where the application should saved the backed up copies.
	 */
	public static String getCollectEarthDataFolder() {

		File localFolder = null;
		String absolutePath = null;
		try {
			String userHome = getUserHome();

			userHome += EarthConstants.COLLECT_EARTH_APPDATA_FOLDER;
			localFolder = new File(userHome);
			localFolder.mkdirs();
			absolutePath = localFolder.getAbsolutePath();
		} catch (Exception e) {
			logger.error("Error getting Collect Earth data folder", e);
		}
		return absolutePath;
	}

	public static String getCollectEarthDataFolderNoAmpersad() {
		String dataFolder = getCollectEarthDataFolder();
		// Remove ampersands from the URL (like in case a username is something like "Romeo&Giulietta") so that the SAX parser does not confuse it with an XML entity
		dataFolder =  dataFolder.replaceAll( "&([^;]+(?!(?:\\w|;)))", "&amp;$1" );
		return dataFolder;
	}

	private static String getUserHome() {
		String userHome = "" ;

		if (SystemUtils.IS_OS_WINDOWS){
			userHome = System.getenv("APPDATA") + File.separatorChar;
		}else if (SystemUtils.IS_OS_MAC){
			userHome = System.getProperty("user.home") + "/Library/Application Support/";
		}else if ( SystemUtils.IS_OS_UNIX){
			userHome = System.getProperty("user.home") + "/";
		}
		return userHome;
	}


	/**
	 * Returns a folder inside the appfolder should be placed.
	 * @param folderName The name of the new folder to be created
	 * @return The name of the new forlder
	 */
	public static File createFolderInAppData( String folderName) {
		String localFolderPath = FolderFinder.getCollectEarthDataFolder() + File.separatorChar + folderName;
		File localFolder = new File(localFolderPath);
		localFolder.mkdirs();
		return localFolder;
	}

	public static String getLocalAppDataFolder(){
		String appDataFolder = getUserHome();
		if (SystemUtils.IS_OS_WINDOWS){
			if( ! appDataFolder.toLowerCase().endsWith("local")){
				File roaming = new File(appDataFolder);
				File local = new File( roaming.getParentFile(), "Local");
				appDataFolder = local.getAbsolutePath();
			}
		}
		return appDataFolder;
	}

}
