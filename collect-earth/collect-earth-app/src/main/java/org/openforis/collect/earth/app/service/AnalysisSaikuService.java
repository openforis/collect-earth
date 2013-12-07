package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.lang.ProcessBuilder.Redirect;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class AnalysisSaikuService {

	@Autowired
	CollectRDBPublisher collectRDBPublisher;
	
	@Autowired
	SurveyManager surveyManager;
	
	@Autowired
	LocalPropertiesService localPropertiesService;
	
	@Autowired
	BrowserService browserService;
	
	private Logger logger = LoggerFactory.getLogger( AnalysisSaikuService.class );
	
	public void prepareAnalysis(){
		
		try {
			removeOldRdb();
			collectRDBPublisher.export( EarthConstants.EARTH_SURVEY_NAME, EarthConstants.ROOT_ENTITY_NAME, Step.ENTRY, null );
			
			try {
				copyDbToSaikuFolder();
				startSaiku();
				openSaiku();
				stopSaikuOnExit();
			} catch (IOException e) {
				logger.error("Error while producing Relational DB from Collect format", e);
			}
			
		} catch (CollectRdbException e) {
			logger.error("Error while producing Relational DB from Collect format", e);
		} 
	}

	private void stopSaikuOnExit() {
		Runtime.getRuntime().addShutdownHook(new Thread() {
			@Override
			public void run() {
				String endSaikuCmd = getSaikuFolder() + File.separator + "stop-saiku.bat";
				try {
					ProcessBuilder builder = new ProcessBuilder(endSaikuCmd);
					builder.directory( new File(getSaikuFolder() ) );
					builder.redirectErrorStream(true);
					builder.redirectOutput(Redirect.INHERIT);
					builder.redirectError(Redirect.INHERIT);
					builder.start();
				} catch (IOException e) {
					logger.error("Error stopping Saiku", e);
				}
			}
		});
	}

	private void openSaiku() throws IOException {
		browserService.navigateTo(" http://localhost:8181", null);
	}

	private  void startSaiku() throws IOException {
		String openSaikuCmd = getSaikuFolder() + File.separator + "start-saiku.bat";	
		ProcessBuilder builder = new ProcessBuilder(openSaikuCmd);
		builder.directory( new File(getSaikuFolder() ) );
		builder.redirectErrorStream(true);
		builder.redirectOutput(Redirect.INHERIT);
		builder.redirectError(Redirect.INHERIT);
		builder.start();
		
	}

	private void copyDbToSaikuFolder() throws IOException {
		FileUtils.copyFile( new File("collectEarthDatabaseRDB.db"), new File(getSaikuFolder() + File.separatorChar + "collectEarthDatabaseRDB.db") );
		
	}

	private void removeOldRdb() {
		File oldRdbFile = new File("collectEarthDatabaseRDB.db");
		oldRdbFile.delete();
	}
	
	private String getSaikuFolder(){
		return localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER);
	}
	
	
	
	
}
