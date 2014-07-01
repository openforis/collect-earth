package org.openforis.collect.earth.app.service;

import java.io.File;

import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.EarthConstants;

public class FolderFinder {

	private FolderFinder(){
		
	} 
	/**
	 * Returns the folder where the backup copies should be placed.
	 * @return The OS dependent folder where the application should saved the backed up copies. 
	 */
	public static File getLocalFolder() {

		File localFolder = null;
		try {
			String userHome = "" ; 
			
			if (SystemUtils.IS_OS_WINDOWS){
				userHome = System.getenv("APPDATA") + File.separatorChar;
			}else if (SystemUtils.IS_OS_MAC){
				userHome = System.getProperty("user.home") + "/Library/Application Support/";
			}else if ( SystemUtils.IS_OS_UNIX){
				userHome = System.getProperty("user.home") + "/.";
			}

			userHome += EarthConstants.COLLECT_EARTH_APPDATA_FOLDER;
			localFolder = new File(userHome);
			localFolder.mkdirs();
		} catch (Exception e) {
			e.printStackTrace(); // ATTENTION do not use a logger here!
		}
		return localFolder;
	}
}
