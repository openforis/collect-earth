package org.openforis.collect.earth.app.service;

import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Properties;
import java.util.concurrent.TimeUnit;

import javax.xml.parsers.DocumentBuilderFactory;

import org.apache.commons.lang.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.w3c.dom.Document;

public class UpdateIniUtils {

	private static final Logger logger = LoggerFactory.getLogger(UpdateIniUtils.class);
	private static final SimpleDateFormat fromXml = new SimpleDateFormat("yyyyMMddHHmm");
	public static final String UPDATE_INI = "update.ini";
	

	/**
	 * Checks if there is a newer version of the Collect Earth updater available
	 * @param pathToUpdateIni THe path to the update.ini file that is compliant with Installbuilder http://installbuilder.bitrock.com/docs/installbuilder-userguide/ar01s23.html
	 * @return The new version build-number if there is a new version. Null if the version online is not newer than the one installed
	 */
	public String getNewVersionAvailable(){

		String installedVersionBuild = getVersionInstalled();
		String urlXmlUpdaterOnline = getValueFromUpdateIni("url", UPDATE_INI); //$NON-NLS-1$
		String onlineVersionBuild = getVersionBuild(urlXmlUpdaterOnline);


		try {
			Long installedBuild = new Long(installedVersionBuild);
			Long onlineBuild = new Long(onlineVersionBuild);

			if( onlineBuild.longValue() > installedBuild.longValue() ){
				return onlineBuild+""; //$NON-NLS-1$
			}

		} catch (NumberFormatException e) {
			logger.error("Error parsing the buildNumber ", e); //$NON-NLS-1$
		}

		return null;
	}

	private String getVersionInstalled() {
		String installedVersionBuild = getValueFromUpdateIni("version_id", UPDATE_INI); //$NON-NLS-1$
		return installedVersionBuild;
	}

	public boolean shouldWarnUser( String currentVersionOnline, LocalPropertiesService localPropertiesService ){
		boolean warnUser = false;
		
		boolean newerVersionAvailable = !StringUtils.isEmpty( currentVersionOnline ) ;
		if( newerVersionAvailable ){
			
			// There is a new version. did the user chose "Not to be bother"with this update?
			String lastIgnoredBuildNumber = localPropertiesService.getValue(EarthProperty.LAST_IGNORED_UPDATE);
		
			if( isCurrentNewerThanIgnoredUpdate(lastIgnoredBuildNumber, currentVersionOnline) && isMajorUpdate()){
				warnUser = true;
			}else if( isInstalledOlderThanOneMonth(currentVersionOnline, getVersionInstalled()) ){
				warnUser = true;
			}			

		}
		return warnUser;
	}
	

	/**
	 * Check if the current version of the updater is newer than the version of the updater that was last ignored
	 * @param lastIgnoredBuildNumber The version of the last ignored updater as a string with the format yyyyMMddHHmm
	 * @param buildNumberOnline The version of the current updater in the server in the format yyyyMMddHHmm
	 * @return True is the new version of the updater is newer than the one last ignored. False otherwise
	 */
	private boolean isCurrentNewerThanIgnoredUpdate(String lastIgnoredBuildNumber, String buildNumberOnline){
		
		boolean isNewerThanIgnored = true;
		
		try {
			if( !StringUtils.isEmpty(lastIgnoredBuildNumber) && !StringUtils.isEmpty(buildNumberOnline) ){
				Long ignoredBuildNumberUpdate =new Long(lastIgnoredBuildNumber);
				Long buildOnline = new Long( buildNumberOnline );

				isNewerThanIgnored = ignoredBuildNumberUpdate<buildOnline; // If the build number that was ignored was older than the current build number on the server and hte new version is marked as "major"
			}
		} catch (NumberFormatException e) {
			logger.error( "Error checking if the current version of the updater is newer than the updater that was last ignored", e);
		}
		
		return isNewerThanIgnored;
	}

	
	/**
	 * This method checks the difference in dates between the currently installed version of Collect Earth and the latest update available
	 * @param currentVersion The date of the currently available version of collect earth in the format yyyyMMddHHmm
	 * @param installedVersion The date of the installed version of Collect Earth in the format yyyyMMddHHmm
	 * @return True if the difference on the dates is more than 30 days, false otherwise
	 */
	private boolean isInstalledOlderThanOneMonth( String currentVersion, String installedVersion ){
		
		boolean isOlderThanOneMonth = true;
		Date d1 = null;
		Date d2 = null;
		try {
		    d1 = fromXml.parse(installedVersion);
		    d2 = fromXml.parse(currentVersion);
			long diff = d2.getTime() - d1.getTime();//as given
			long daysDifferenceInstalledAndCurrent = TimeUnit.MILLISECONDS.toDays(diff);
			isOlderThanOneMonth = (daysDifferenceInstalledAndCurrent > 30);
		} catch (Exception e) {
		   logger.error( "Error calculating difference in dates bvetween installed and available versions", e );
		}    
		
		return isOlderThanOneMonth;
	}
	

	/**
	 * Checks if the update in the server is a "Major"update, meaning that every user should update Collect Earth
	 * @return True if the version on the server should be installed by all users
	 */
	public boolean isMajorUpdate() {
		String urlXmlUpdaterOnline = getValueFromUpdateIni("url", UPDATE_INI); //$NON-NLS-1$
		String tagname = "version"; //$NON-NLS-1$
		
		String majorUpdateString = getXmlValueFromTag(urlXmlUpdaterOnline, tagname);
		return majorUpdateString.toLowerCase().contains("major");
	}

	private String getVersionBuild(String urlXmlUpdate) {
		String tagname = "versionId"; //$NON-NLS-1$
		return getXmlValueFromTag(urlXmlUpdate, tagname);		
	}

	public String getXmlValueFromTag(String urlXmlUpdate, String tagname) {

		String onlineVersion = "0";  //$NON-NLS-1$
		try {
			DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
			factory.setNamespaceAware(true);
			Document parse = factory.newDocumentBuilder().parse(new URL(urlXmlUpdate).openStream());

			onlineVersion = parse.getElementsByTagName(tagname).item(0).getChildNodes().item(0).getNodeValue();
		} catch (Exception e) {
			logger.warn("Error while reading the remote XML where the updater version is defined", e); //$NON-NLS-1$
		}

		return onlineVersion;
	}

	public static String getValueFromUpdateIni(String key, String pathToUpdateIni) {
		Properties properties = new Properties();
		String value = "unknown"; //$NON-NLS-1$
		try {
			properties.load( new FileInputStream(pathToUpdateIni));	
			value = properties.getProperty(key);
		} catch (FileNotFoundException e) {
			logger.error("The update.ini file could not be found", e); //$NON-NLS-1$
		} catch (IOException e) {
			logger.error("Error opening the update.ini file", e); //$NON-NLS-1$
		}
		return value;
	}

	public String convertToDate(String buildVersionNumber) {
		SimpleDateFormat humanReadable = new SimpleDateFormat("yyyy-MM-dd");
		String reformattedStr = buildVersionNumber;
		try {
			
			reformattedStr = humanReadable.format(fromXml.parse(buildVersionNumber));
		} catch (java.text.ParseException e) {
			logger.error("Error parsing the date from the XML updater" , e );
		}
		
		return reformattedStr;
	}
}
