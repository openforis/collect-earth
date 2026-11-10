package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;

import org.apache.commons.codec.digest.DigestUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import net.lingala.zip4j.ZipFile;

public abstract class GenerateDatabase {


	Logger logger = LoggerFactory.getLogger( GenerateDatabase.class);
	boolean refreshDatabase;
	boolean userCancelledOperation = false;
	
	public GenerateDatabase() {
		super();
	}

	public abstract EarthSurveyService getEarthSurveyService();
	public abstract LocalPropertiesService getLocalPropertiesService();
	public abstract RDBExporter getRdbExporter();
	
	private String getRdbFilePrefix( ExportType type ) {
		String result = "";
		try {
			String concatenation = getEarthSurveyService().getCollectSurvey().getUri()
					+ getEarthSurveyService().getCollectSurvey().getName();
			result = DigestUtils.md5Hex(concatenation);
		} catch (Exception e) {
			logger.error("Problems getting the MD5 hash of the project name", e);
		}
		return result;
	}

	protected File getZippedProjectDB( ExportType type ) {

		File dbFolder = new File(FolderFinder.getCollectEarthDataFolder() + File.separator + type.getDataFolder());

		if (!dbFolder.exists()) {
			dbFolder.mkdir();
		}

		return new File(dbFolder.getAbsolutePath() + File.separator + getRdbFilePrefix( type ) 
				+ type.getDbSuffix()  + ".zip");
	}

	public boolean isRdbAlreadyGenerated(ExportType type) {

		boolean dbAlreadyPresent = false;
		if (getLocalPropertiesService().isUsingSqliteDB()) {
			File rdbFile = getZippedProjectDB( type );
			dbAlreadyPresent = rdbFile.exists();
		} else {
			// Here we should check if the "rdbcollectearth" schema is created in the
			// PostgreSQL database
			dbAlreadyPresent = true;
		}

		return dbAlreadyPresent;
	}

	protected boolean isRefreshDatabase() {
		return refreshDatabase;
	}

	protected boolean isUserCancelledOperation() {
		return userCancelledOperation;
	}

	protected void replaceZippedProjectDB(ExportType type) throws IOException {
		if ( getLocalPropertiesService().isUsingSqliteDB()) {
			CollectEarthUtils.addFileToZip(
					getZippedProjectDB( type ), 
					getRdbExporter().getRdbFile( type ),
					getRdbExporter().getRdbFile( type ).getName()
				);
		}
	}
	
	boolean restoreZippedProjectDB( ExportType type ) {
		boolean restored = false;
		if (getZippedProjectDB( type ).exists()) {
			// Unzip file

			try (ZipFile zippedProjectData = new ZipFile(getZippedProjectDB( type ))) {
				zippedProjectData.extractAll(FolderFinder.getCollectEarthDataFolder());
				zippedProjectData.close();
				restored = true;
			} catch (IOException e) {
				logger.error("Problems unzipping the contents of the zipped relational DB to the local user folder ", e);
			}

		}
		return restored;
	}
	
	public void setRefreshDatabase(boolean refreshDatabase) {
		this.refreshDatabase = refreshDatabase;
	}

	public void setUserCancelledOperation(boolean userCancelledOperation) {
		this.userCancelledOperation = userCancelledOperation;
	}
}