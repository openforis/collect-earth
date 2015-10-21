package org.openforis.collect.earth.app.service;

import java.awt.Toolkit;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.StringSelection;
import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.util.NoSuchElementException;

import liquibase.util.SystemUtils;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang3.ArrayUtils;
import org.openqa.selenium.By;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class PlaygroundHandlerThread {
	private static final String RUN_SCRIPT_BUTTON = "button.goog-button:nth-child(5)";
	private String[] latLong;
	private RemoteWebDriver webDriverGee;
		
	@Autowired
	private BrowserService browserService;
	private Logger logger = LoggerFactory.getLogger( PlaygroundHandlerThread.class);
	
	@Autowired
	private GeolocalizeMapService geoLocalizeTemplateService;
	
	@Autowired
	private LocalPropertiesService localPropertiesService;
	private boolean waitingForLogin = false;


	public boolean isPlaygroundShowing() {
		return BrowserService.isCssElementPresent( RUN_SCRIPT_BUTTON, webDriverGee);
	}

	public void runPlaygroundScript()
			throws IOException, URISyntaxException,
			InterruptedException {
		
		URL fileWithScript = geoLocalizeTemplateService.getTemporaryUrl(latLong, getGeePlaygroundTemplate());
		
		webDriverGee.findElementByCssSelector(RUN_SCRIPT_BUTTON).click();
		
		WebElement textArea = webDriverGee.findElement(By.className("ace_text-input"));
		
		
		if( SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX){
		    // Command key (apple key) is not working on Chrome on Mac. Try with the right clik
			// This is not going to be fixed by Selenium
			// Try a different approach! A bit slower but works
			String contents =  FileUtils.readFileToString( new File(fileWithScript.toURI())) ;
			// Remove comments so it is faster to send the text!
			String noComments = removeComments(contents); 		
			// Clear the code area
			webDriverGee.findElementByCssSelector("div.goog-inline-block.goog-flat-menu-button.custom-reset-button").click();
			webDriverGee.findElementByXPath("//*[contains(text(), 'Clear script')]").click();
			// Send the content of the script
			textArea.sendKeys( noComments );
			// Fix the extra characters added by removing the last 10 chars ( this is a bug from Selenium! )
			textArea.sendKeys(Keys.PAGE_DOWN);
			for( int i=0; i<10; i++){
				textArea.sendKeys(Keys.BACK_SPACE);
			}
			
		}else{
			Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
			String contents = FileUtils.readFileToString( new File(fileWithScript.toURI()));
			StringSelection clipboardtext = new StringSelection( contents );
			clipboard.setContents(clipboardtext, null);
			textArea.sendKeys(Keys.chord(Keys.CONTROL,"a"));
			textArea.sendKeys(Keys.chord(Keys.CONTROL,"v"));
		}
		
		
		//((JavascriptExecutor)webDriverGeePlayground).executeScript("arguments[0].value = arguments[1];", textArea,);
		Thread.sleep(1000);
		webDriverGee.findElementByCssSelector("button.goog-button.run-button").click();
	}

	public String removeComments(String contents) {
		String noComments = "";
		int indexComments = contents.indexOf("//");
		if( indexComments != -1 ){
			while( indexComments >= 0){
				int endOfLine = contents.indexOf("\r\n", indexComments);		
				if( endOfLine != -1 )
					indexComments = contents.indexOf("//", endOfLine+2 );
				else{
					indexComments = -1;
					break;
				}
				
				if( indexComments != -1 )
					noComments += contents.substring( endOfLine, indexComments ).trim();
				else
					noComments += contents.substring( endOfLine).trim();
			}
		}else
			noComments = contents;
		return noComments;
	}

	/**
	 * Get the GEE Playground script that should be used.
	 * There is an standard one that resides in resources/eePlaygroundScript.fmt but a project might have its own script.
	 * 
	 * @return The generic script in the resources folder or the file called eePlaygroundScript.fmt in hte same folder where the current project file resides
	 */
	private String getGeePlaygroundTemplate() {

		String projectPlaygroundScript = getProjectGeeScript();
		if( projectPlaygroundScript != null  ){
			return projectPlaygroundScript;
		}else{
			return GeolocalizeMapService.FREEMARKER_GEE_PLAYGROUND_TEMPLATE;
		}
		
	}
	
	/**
	 * Find the GEE playground script that should be used for the project that is currently loaded in Collect Earth
	 * @return The path to the GEE playground generic script or the one that is specified in the project folder if it exists. 
	 */
	private String getProjectGeeScript() {
		// Where the meta-data file (usually placemark.idm.xml ) is located
		
		// Is there a "eePlaygroundScript.fmt" file in the same folder than in the metadata file folder?
		File projectGeePlayground = new File( localPropertiesService.getProjectFolder() + File.separatorChar + GeolocalizeMapService.FREEMARKER_GEE_PLAYGROUND_TEMPLATE_FILE_NAME);
		
		String geePlaygroundFilePath = null;
		if( projectGeePlayground.exists() ){
			geePlaygroundFilePath = projectGeePlayground.getAbsolutePath();
		}
		return geePlaygroundFilePath;
	}

	public void loadPlaygroundScript(String[] latLong, RemoteWebDriver webDriverGeePlayground) {
		this.latLong = latLong;
		this.webDriverGee = webDriverGeePlayground;
		Thread loadGee = new Thread("Opening GEE Playground " + ArrayUtils.toString(latLong)){
			@Override
			public void run() {
				try {			
					if (!isPlaygroundShowing()) {
						// Open GEE Playground
						if( !browserService.isDriverWorking(webDriverGee) || webDriverGee.getCurrentUrl()==null || ( !webDriverGee.getCurrentUrl().contains("google") && !webDriverGee.getCurrentUrl().contains("google") ) ){
							webDriverGee = browserService.navigateTo(  localPropertiesService.getGeePlaygoundUrl(), webDriverGee);
							browserService.setWebDriverGeePlayground(webDriverGee);
						}
						// Now we have to wait until the user logs into Google Earth Enmgine!
						waitingForLogin = true;
						
						
						// Initially the login page appears!
						// wait until the user logs - in  ( but no more than 5 minutes )
						
						while( waitingForLogin && !isPlaygroundShowing()  ){ // 5 minutes a 2 seconds == 30 * 5 = 150 
							sleep(2000);
						}
						
						// If the reason to get to this point is not that we have waited more than 5 minutes....
						if( waitingForLogin){
							stopWaitingForLogin();
							runPlaygroundScript();
						}
						
						
					}else{						
						runPlaygroundScript();
					}
					
				} catch (final NoSuchElementException e) {
					// This is a well known exception. Down-grade if to warning
					logger.warn("Error when opening Earth Engine browser window. Known problem", e);
				} catch (final Exception e) {
					// This is a well known exception. 
					logger.error("Error when opening Earth Engine browser window", e);
				}
			}

		};
		loadGee.start();
	}

	public boolean isWaitingForLogin() {
		return waitingForLogin;
	}

	public void stopWaitingForLogin() {
		waitingForLogin = false;		
	}
}

