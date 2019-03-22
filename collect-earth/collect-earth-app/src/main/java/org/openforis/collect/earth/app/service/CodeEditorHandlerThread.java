package org.openforis.collect.earth.app.service;

import java.awt.Toolkit;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.StringSelection;
import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.NoSuchElementException;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang.StringUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.openqa.selenium.remote.RemoteWebElement;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import liquibase.util.SystemUtils;

@Component
public class CodeEditorHandlerThread {
	private static final String RUN_SCRIPT_BUTTON = "button.run-button";
	private static final String RESET_SCRIPT_BUTTON = "button.reset-button";
	private SimplePlacemarkObject placemarkObject;

	private RemoteWebDriver webDriverGee;

	@Autowired
	private BrowserService browserService;
	private Logger logger = LoggerFactory.getLogger(CodeEditorHandlerThread.class);

	@Autowired
	private GeolocalizeMapService geoLocalizeTemplateService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	public boolean isCodeEditorShowing() {
		return BrowserService.isCssElementPresent(RUN_SCRIPT_BUTTON, webDriverGee);
	}

	public void runScript() throws IOException, URISyntaxException, InterruptedException {

		
		try {
			WebElement resetButton = webDriverGee.findElementByCssSelector(RESET_SCRIPT_BUTTON);
			
			forceClick( resetButton );
		
			URL fileWithScript = geoLocalizeTemplateService.getTemporaryUrl(placemarkObject, getGeeCodeEditorTemplate());
	
			WebElement textArea = webDriverGee.findElement(By.className("ace_text-input"));
	
			String contents = FileUtils.readFileToString(new File(fileWithScript.toURI()), Charset.forName("UTF-8"));
			
			if (SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX) {
				sendThroughKeys(textArea, contents);
	
			} else {
				sendThroughClipboard(textArea, contents);
				try {
					// Fix bug provoked by antivirus not accepting the control characters sent by Selenium
					if( webDriverGee.findElement(By.className("ace_line") ).getAttribute("value").trim().equals("av") ) {
						sendThroughKeys(textArea, contents);
					}
				} catch (Exception e) {

					logger.warn("Error while refreshing code editor", e);
					
				}
			}
	
			Thread.sleep(1000);
			WebElement runButton = webDriverGee.findElementByCssSelector(RUN_SCRIPT_BUTTON);
			forceClick( runButton );
		} catch (NoSuchElementException e) {

			webDriverGee.executeScript( "alert('test alert')" );
			
		}

	}

	private void sendThroughClipboard(WebElement textArea, String contents) {
		Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
		StringSelection clipboardtext = new StringSelection(contents);
		clipboard.setContents(clipboardtext, null);
		Keys controlChar = Keys.CONTROL;
		if (SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX) {
			controlChar = Keys.COMMAND;
		}
		textArea.sendKeys(Keys.chord(controlChar, "a"));
		textArea.sendKeys(Keys.chord(controlChar, "v"));
	}

	private void sendThroughKeys(WebElement textArea, String contents)
			throws InterruptedException {
		// Command key (apple key) is not working on Chrome on Mac. Try with the right click
		// This is not going to be fixed by Selenium
		
		// Remove comments so it is faster to send the text!
		String noComments = removeComments(contents);

		// Clear the code area
		WebElement clearButton = webDriverGee.findElementByCssSelector(RESET_SCRIPT_BUTTON);
		forceClick( clearButton );

		StringBuilder fixedScriptForMac = new StringBuilder();
		String[] lines = noComments.split("\\n");
		for (String line : lines) {
			// Send the content of the script
			String trimmedLine = line.trim();

			// Add Spaces after "{" so we avoid the automatic closing of the method by GEE
			// Playground JS
			trimmedLine = trimmedLine.replace("{", "{ ");

			if (!StringUtils.isBlank(trimmedLine)) {
				fixedScriptForMac = fixedScriptForMac.append(trimmedLine).append("\n");
			}
		}

		fixedScriptForMac.append("//THE END"); // Don't remove this!!! this way we mark the point where there should be no trailing character removal
		Keys controlChar = Keys.CONTROL;
		if (SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX) {
			controlChar = Keys.COMMAND;
		}
		textArea.sendKeys(Keys.chord(controlChar, "a"));
		textArea.sendKeys(fixedScriptForMac);
/*
		Thread.sleep(500);
		// Fix the extra characters added by removing the last 10 chars ( this is a bug from Selenium! )
		textArea.sendKeys(Keys.PAGE_DOWN);
		Thread.sleep(500);
		textArea.sendKeys(Keys.PAGE_DOWN);
		*/
	}
	
	private void forceClick( WebElement element ) {
		JavascriptExecutor js = (JavascriptExecutor)webDriverGee;
		js.executeScript("arguments[0].click();", element);
	}

	public String removeComments(String contents) {

		String wholeCode = contents;
		wholeCode = wholeCode.replaceAll("http://", "");
		wholeCode = wholeCode.replaceAll("https://", "");
		wholeCode = wholeCode.replaceAll("\r", "");

		StringBuilder noComments = new StringBuilder("");
		int indexComments = contents.indexOf("//");
		if (indexComments != -1) {
			while (indexComments >= 0) {
				int endOfLine = contents.indexOf('\n', indexComments);
				if (endOfLine != -1)
					indexComments = contents.indexOf("//", endOfLine + 2);
				else {
					break;
				}

				if (indexComments != -1)
					noComments = noComments.append(contents.substring(endOfLine, indexComments));
				else
					noComments = noComments.append(contents.substring(endOfLine));
			}
			return noComments.toString();
		} else
			return wholeCode;
	}

	/**
	 * Get the GEE Playground script that should be used. There is an standard one
	 * that resides in resources/eePlaygroundScript.fmt but a project might have its
	 * own script.
	 * 
	 * @return The generic script in the resources folder or the file called
	 *         eePlaygroundScript.fmt in hte same folder where the current project
	 *         file resides
	 */
	private String getGeeCodeEditorTemplate() {

		String projectPlaygroundScript = getProjectGeeScript();
		if (projectPlaygroundScript != null) {
			return projectPlaygroundScript;
		} else {
			return GeolocalizeMapService.FREEMARKER_GEE_CODE_EDITOR_TEMPLATE; // New format name since version 1.6.20
		}

	}

	/**
	 * @return The path to the GEE Code Editor generic script or the one that is
	 *         specified in the project folder if it exists.
	 */
	private String getProjectGeeScript() {
		// Is there a "eePlaygroundScript.fmt" file in the same folder than in the
		// metadata file folder?
		File projectGeePlayground = new File(localPropertiesService.getProjectFolder() + File.separatorChar
				+ GeolocalizeMapService.FREEMARKER_GEE_PLAYGROUND_TEMPLATE_FILE_NAME);

		// Is there a "eeCodeEditorScript.fmt" file in the same folder than in the
		// metadata file folder? NEW NAME AFTER 12/2017!!!
		File projectGeeCodeEditor = new File(localPropertiesService.getProjectFolder() + File.separatorChar
				+ GeolocalizeMapService.FREEMARKER_GEE_PLAYGROUND_TEMPLATE_FILE_NAME);

		String geeFilePath = null;
		if (projectGeeCodeEditor.exists()) { // The new format name takes precedence
			geeFilePath = projectGeeCodeEditor.getAbsolutePath();
		} else if (projectGeePlayground.exists()) {
			geeFilePath = projectGeePlayground.getAbsolutePath();
		}
		return geeFilePath;
	}

	public void loadCodeEditorScript(SimplePlacemarkObject placemarkObject, RemoteWebDriver webDriverGeePlayground) {
		this.placemarkObject = placemarkObject;
		loadCodeEditorScript(webDriverGeePlayground);
	}

	public void disableCodeEditorAutocomplete(RemoteWebDriver webDriverCodeEditor) {
		this.webDriverGee = webDriverCodeEditor;
		try {
			if (!isCodeEditorShowing()) {
				// Open GEE Playground
				if (!browserService.isDriverWorking(webDriverGee) || webDriverGee.getCurrentUrl() == null
						|| !webDriverGee.getCurrentUrl().contains("google")) {
					webDriverGee = browserService.navigateTo(localPropertiesService.getGeePlaygoundUrl(), webDriverGee);
					browserService.setWebDriverGeeCodeEditor(webDriverGee);
				}

				// Initially the login page appears!
				while (!isCodeEditorShowing()) { // 5 minutes a 2 seconds == 30 * 5 = 150
					Thread.sleep(2000);
				}

			} else {
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

	private void disableAutoComplete() {
		// Display the settings in Google Earth Engine Code Editor (this emulates
		// clicking on the settings icon)
		webDriverGee.findElementByClassName("settings-menu-button").click();
		// Get the Div that is the parent of the one with text that contains
		// Autocomplete
		RemoteWebElement autocompleteButton = (RemoteWebElement) webDriverGee
				.findElementByXPath("//div[contains(text(), \"Autocomplete\")]/..");

		if (isAutocompleChecked(autocompleteButton)) {
			// Disable the Autocomplete of special characters
			autocompleteButton.click();
		}

	}

	public boolean isAutocompleChecked(RemoteWebElement autocompleteButton) {
		String buttonChecked = autocompleteButton.getAttribute("aria-checked");
		return buttonChecked.equals("true");
	}

	private void loadCodeEditorScript(RemoteWebDriver webDriverCodeEditor) {
		this.webDriverGee = webDriverCodeEditor;
		Thread loadGee = new Thread(
				"Opening GEE Playground " + (placemarkObject != null ? placemarkObject.toString() : "")) {
			@Override
			public void run() {
				try {
					if (!isCodeEditorShowing()) {
						// Open GEE Code Editor
						if (!browserService.isDriverWorking(webDriverGee) || webDriverGee.getCurrentUrl() == null
								|| !webDriverGee.getCurrentUrl().contains("google")) {
							webDriverGee = browserService.navigateTo(localPropertiesService.getGeePlaygoundUrl(),
									webDriverGee);
							browserService.setWebDriverGeeCodeEditor(webDriverGee);
						}
						// Initially the login page appears!
						while (!isCodeEditorShowing()) {
							sleep(2000);
						}
					}
					runScript();
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
}
