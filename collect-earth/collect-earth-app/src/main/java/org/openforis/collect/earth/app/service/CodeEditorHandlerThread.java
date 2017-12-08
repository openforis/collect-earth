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
import org.apache.commons.lang.StringUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openqa.selenium.By;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.openqa.selenium.remote.RemoteWebElement;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class CodeEditorHandlerThread {
	private static final String RUN_SCRIPT_BUTTON = "button.goog-button:nth-child(5)";
	private static final int DUMMY_SPACES = 150;
	private SimplePlacemarkObject placemarkObject;
	
	private RemoteWebDriver webDriverGee;
		
	@Autowired
	private BrowserService browserService;
	private Logger logger = LoggerFactory.getLogger( CodeEditorHandlerThread.class);
	
	@Autowired
	private GeolocalizeMapService geoLocalizeTemplateService;
	
	@Autowired
	private LocalPropertiesService localPropertiesService;
	private boolean waitingForLogin = false;


	public boolean isCodeEditorShowing() {
		return BrowserService.isCssElementPresent( RUN_SCRIPT_BUTTON, webDriverGee);
	}

	public void runScript()
			throws IOException, URISyntaxException,
			InterruptedException {
		
		
		URL fileWithScript = geoLocalizeTemplateService.getTemporaryUrl(placemarkObject, getGeeCodeEditorTemplate());
		
		
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
			
			StringBuffer fixedScriptForMac = new StringBuffer();
			String[] lines = noComments.split("\\n");
			for (String line : lines) {
				// Send the content of the script
				String trimmedLine = line.trim();
				
				// Add Spaces after "{" so we avoid the automatic closing of the method by GEE Playground JS
				trimmedLine = trimmedLine.replace("{", "{ ");
				
				if( !StringUtils.isBlank(trimmedLine) ){
					fixedScriptForMac = fixedScriptForMac.append(trimmedLine).append("\n");					
				}
			}
			
			fixedScriptForMac.append("//THE END"); // Don't remove this!!! this way we mark the point where tere should be no trailing character removal
			
						
			textArea.sendKeys(fixedScriptForMac);
			
			Thread.sleep(5000);
			// Fix the extra characters added by removing the last 10 chars ( this is a bug from Selenium! )
			textArea.sendKeys(Keys.PAGE_DOWN);
			Thread.sleep(500);
			textArea.sendKeys(Keys.PAGE_DOWN);
			
			
			
		}else{
			Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
			String contents = FileUtils.readFileToString( new File(fileWithScript.toURI()));
			StringSelection clipboardtext = new StringSelection( contents );
			clipboard.setContents(clipboardtext, null);
			Keys controlChar = Keys.CONTROL;
			if( SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX ){
				controlChar = Keys.COMMAND;
			}
			textArea.sendKeys(Keys.chord(controlChar,"a"));
			textArea.sendKeys(Keys.chord(controlChar,"v"));
		}
		
		
		//((JavascriptExecutor)webDriverGeePlayground).executeScript("arguments[0].value = arguments[1];", textArea,);
		Thread.sleep(1000);
		webDriverGee.findElementByCssSelector("button.goog-button.run-button").click();
	}


	public String removeComments(String contents) {
		
		
		contents = contents.replaceAll("http://", "");
		contents = contents.replaceAll("https://", "");
		contents  = contents.replaceAll("\r","");
		
		String noComments = "";
		int indexComments = contents.indexOf("//");
		if( indexComments != -1 ){
			while( indexComments >= 0){
				int endOfLine = contents.indexOf("\n", indexComments);		
				if( endOfLine != -1 )
					indexComments = contents.indexOf("//", endOfLine+2 );
				else{
					indexComments = -1;
					break;
				}
				
				if( indexComments != -1 )
					noComments += contents.substring( endOfLine, indexComments );
				else
					noComments += contents.substring( endOfLine);
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
	private String getGeeCodeEditorTemplate() {

		String projectPlaygroundScript = getProjectGeeScript();
		if( projectPlaygroundScript != null  ){
			return projectPlaygroundScript;
		}else{
			return GeolocalizeMapService.FREEMARKER_GEE_CODE_EDITOR_TEMPLATE; // New format name since version 1.6.20
		}
		
	}
	
	/**
	 * Find the GEE playground script that should be used for the project that is currently loaded in Collect Earth
	 * @return The path to the GEE playground generic script or the one that is specified in the project folder if it exists. 
	 */
	private String getProjectGeeScript() {
		// Is there a "eePlaygroundScript.fmt" file in the same folder than in the metadata file folder?
		File projectGeePlayground = new File( localPropertiesService.getProjectFolder() + File.separatorChar + GeolocalizeMapService.FREEMARKER_GEE_PLAYGROUND_TEMPLATE_FILE_NAME);
		
		// Is there a "eeCodeEditorScript.fmt" file in the same folder than in the metadata file folder? NEW NAME AFTER 12/2017!!!
		File projectGeeCodeEditor = new File( localPropertiesService.getProjectFolder() + File.separatorChar + GeolocalizeMapService.FREEMARKER_GEE_PLAYGROUND_TEMPLATE_FILE_NAME);
		
		String geeFilePath = null;
		if( projectGeeCodeEditor.exists() ){ // The new format name takes precedence
			geeFilePath = projectGeeCodeEditor.getAbsolutePath();
		}else if( projectGeePlayground.exists() ){
			geeFilePath = projectGeePlayground.getAbsolutePath();
		}
		return geeFilePath;
	}
	
	public void loadCodeEditorScript(SimplePlacemarkObject placemarkObject, RemoteWebDriver webDriverGeePlayground) {
		this.placemarkObject = placemarkObject;
		loadCodeEditorScript(webDriverGeePlayground);
	}
	
	public void disableCodeEditorAutocomplete(RemoteWebDriver webDriverCodeEditor){
		this.webDriverGee = webDriverCodeEditor;
		try {			
			if (!isCodeEditorShowing()) {
				// Open GEE Playground
				if( !browserService.isDriverWorking(webDriverGee) || webDriverGee.getCurrentUrl()==null || ( !webDriverGee.getCurrentUrl().contains("google") && !webDriverGee.getCurrentUrl().contains("google") ) ){
					webDriverGee = browserService.navigateTo(  localPropertiesService.getGeePlaygoundUrl(), webDriverGee);
					browserService.setWebDriverGeeCodeEditor(webDriverGee);
				}
				// Now we have to wait until the user logs into Google Earth Engine!
				waitingForLogin = true;
				
				
				// Initially the login page appears!
				// wait until the user logs - in  ( but no more than 5 minutes )
				
				while( waitingForLogin && !isCodeEditorShowing()  ){ // 5 minutes a 2 seconds == 30 * 5 = 150 
					Thread.sleep(2000);
				}
				
				// If the reason to get to this point is not that we have waited more than 5 minutes....
				if( waitingForLogin){
					stopWaitingForLogin();
					disableAutoComplete();
				}
				
				
			}else{						
				disableAutoComplete();
			}
			
		} catch (final NoSuchElementException e) {
			// This is a well known exception. Down-grade if to warning
			logger.warn("Error when opening Earth Engine browser window. Known problem", e);
		} catch (final Exception e) {
			// This is a well known exception. 
			logger.error("Error when opening Earth Engine browser window", e);
		}
	}
	
	private void disableAutoComplete(){
		// Display the settings in Google Earth Engine Code Editor  (this emulates clicking on the settings icon)
		webDriverGee.findElementByClassName("settings-menu-button").click();
		// Get the Div that is the parent of the one with text that contains Autocomplete
		RemoteWebElement autocompleteButton = (RemoteWebElement) webDriverGee.findElementByXPath("//div[contains(text(), \"Autocomplete\")]/..");
		
		if(isAutocompleChecked(autocompleteButton)){
			// Disable the Autocomplete of special characters 
			autocompleteButton.click();
		}
				
		
	}

	public boolean isAutocompleChecked(RemoteWebElement autocompleteButton) {
		String buttonChecked = autocompleteButton.getAttribute("aria-checked");
		return buttonChecked.equals("true" );
	}
	
	private void loadCodeEditorScript(RemoteWebDriver webDriverCodeEditor) {
		this.webDriverGee = webDriverCodeEditor;
		Thread loadGee = new Thread("Opening GEE Playground " +  (placemarkObject != null?placemarkObject.toString():"") ){
			@Override
			public void run() {
				try {			
					if (!isCodeEditorShowing()) {
						// Open GEE Code Editor
						if( !browserService.isDriverWorking(webDriverGee) || webDriverGee.getCurrentUrl()==null || ( !webDriverGee.getCurrentUrl().contains("google") && !webDriverGee.getCurrentUrl().contains("google") ) ){
							webDriverGee = browserService.navigateTo(  localPropertiesService.getGeePlaygoundUrl(), webDriverGee);
							browserService.setWebDriverGeeCodeEditor(webDriverGee);
						}
						// Now we have to wait until the user logs into Google Earth Engine!
						waitingForLogin = true;
						
						
						// Initially the login page appears!
						// wait until the user logs - in  ( but no more than 5 minutes )
						
						while( waitingForLogin && !isCodeEditorShowing()  ){ // 5 minutes a 2 seconds == 30 * 5 = 150 
							sleep(2000);
						}
						
						// If the reason to get to this point is not that we have waited more than 5 minutes....
						if( waitingForLogin){
							stopWaitingForLogin();
							runScript();
						}
						
						
					}else{						
						runScript();
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
