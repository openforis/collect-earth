package org.openforis.collect.earth.app.service;

import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.Properties;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.w3c.dom.Document;
import org.xml.sax.SAXException;

public class UpdateIniUtils {

	private static final Logger logger = LoggerFactory.getLogger(UpdateIniUtils.class);
	
	
	/**
	 * Checks if there is a newer version of the Collect Earth updater available
	 * @param pathToUpdateIni THe path to the update.ini file that is compliant with Installbuilder http://installbuilder.bitrock.com/docs/installbuilder-userguide/ar01s23.html
	 * @return True if a new version is available
	 */
	public boolean isNewVersionAvailable(String pathToUpdateIni){
		
		String installedVersionBuild = getValueFromUpdateIni("version_id", pathToUpdateIni);
		String urlXmlUpdaterOnline = getValueFromUpdateIni("url", pathToUpdateIni);
		String onlineVersionBuild = getVersionBuild(urlXmlUpdaterOnline);
		
		boolean newVersionAvailable = false;
		try {
			Long installedBuild = new Long(installedVersionBuild);
			Long onlineBuild = new Long(onlineVersionBuild);
			
			newVersionAvailable = onlineBuild.intValue() > installedBuild.intValue();
		} catch (NumberFormatException e) {
			logger.error("Error parsing the buildNumber ", e);
		}
		
		return newVersionAvailable;
	}
	
	private String getVersionBuild(String urlXmlUpdate) {
		
		String onlineVersion = "0"; 
		try {
			DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
			factory.setNamespaceAware(true);
			Document parse = factory.newDocumentBuilder().parse(new URL(urlXmlUpdate).openStream());
			onlineVersion = parse.getElementsByTagName("versionId").item(0).getChildNodes().item(0).getNodeValue();
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
