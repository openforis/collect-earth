package org.openforis.collect.earth.app.service;

import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.net.URL;
import java.util.Properties;

import javax.xml.parsers.DocumentBuilderFactory;

import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.w3c.dom.Document;

public class UpdateIniUtils {

	private static final Logger logger = LoggerFactory.getLogger(UpdateIniUtils.class);
	
	
	/**
	 * Checks if there is a newer version of the Collect Earth updater available
	 * @param pathToUpdateIni THe path to the update.ini file that is compliant with Installbuilder http://installbuilder.bitrock.com/docs/installbuilder-userguide/ar01s23.html
	 * @return The new version build-number if there is a new version. Null if the version online is not newer than the one installed
	 */
	public String getNewVersionAvailable(String pathToUpdateIni){
		
		String installedVersionBuild = getValueFromUpdateIni("version_id", pathToUpdateIni);
		String urlXmlUpdaterOnline = getValueFromUpdateIni("url", pathToUpdateIni);
		String onlineVersionBuild = getVersionBuild(urlXmlUpdaterOnline);
		
		
		try {
			Long installedBuild = new Long(installedVersionBuild);
			Long onlineBuild = new Long(onlineVersionBuild);
			
			if( onlineBuild.longValue() > installedBuild.longValue() ){
				return onlineBuild+"";
			}
			
		} catch (NumberFormatException e) {
			logger.error("Error parsing the buildNumber ", e);
		}
		
		return null;
	}
	
	public boolean shouldWarnUser( String buildNumberOnline, LocalPropertiesService localPropertiesService ){
		boolean warnUser = false;
		
		if( buildNumberOnline != null ){
			
			// There is a new version. did the user chose "Not to be bother"with this update?
			String lastIgnoredBuildNumber = localPropertiesService.getValue(EarthProperty.LAST_IGNORED_UPDATE);
			
			if(lastIgnoredBuildNumber.length() > 0){
				Long ignoredBuildNumberUpdate =new Long(lastIgnoredBuildNumber);
				Long buildOnline = new Long( buildNumberOnline );
				
				if( ignoredBuildNumberUpdate<buildOnline){ // If the build number that was ignored was older thanb the current build number on the server
					warnUser = true;
				}
				
			}else{ // The user has never chosen to ignore an update
				warnUser = true;
			}
		}
		
		return warnUser;
	}


	private String getVersionBuild(String urlXmlUpdate) {
		String tagname = "versionId";
		return getXmlValueFromTag(urlXmlUpdate, tagname);		
	}

	public String getXmlValueFromTag(String urlXmlUpdate, String tagname) {
		
		String onlineVersion = "0"; 
		try {
			DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
			factory.setNamespaceAware(true);
			Document parse = factory.newDocumentBuilder().parse(new URL(urlXmlUpdate).openStream());
			
			onlineVersion = parse.getElementsByTagName(tagname).item(0).getChildNodes().item(0).getNodeValue();
		} catch (Exception e) {
			logger.error("Error while reading the remote XML where the updater version is defined", e);
		}
		
		return onlineVersion;
	}

	public static String getValueFromUpdateIni(String key, String pathToUpdateIni) {
		Properties properties = new Properties();
		String value = "unknwown";
		try {
			properties.load( new FileInputStream(pathToUpdateIni));	
			value = properties.getProperty(key);
		} catch (FileNotFoundException e) {
			logger.error("The update.,ini file could not be found", e);
		} catch (IOException e) {
			logger.error("Error opening the update.ini file", e);
		}
		return value;
	}
}
