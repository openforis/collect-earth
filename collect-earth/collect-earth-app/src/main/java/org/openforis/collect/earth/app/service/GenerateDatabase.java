package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

import org.apache.commons.codec.binary.Hex;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.collect.earth.ipcc.RdbExportException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import net.lingala.zip4j.ZipFile;

public abstract class GenerateDatabase {


	boolean refreshDatabase;
	boolean userCancelledOperation = false;
	Logger logger = LoggerFactory.getLogger( GenerateDatabase.class);
	
	public GenerateDatabase() {
		super();
	}

	public abstract void prepareDataForAnalysis(InfiniteProgressMonitor progressListener) throws RdbExportException;
	public abstract LocalPropertiesService getLocalPropertiesService();
	public abstract EarthSurveyService getEarthSurveyService();
	public abstract RDBExporter getRdbExporter();
	
	protected boolean isRefreshDatabase() {
		return refreshDatabase;
	}

	protected boolean isUserCancelledOperation() {
		return userCancelledOperation;
	}

	protected void replaceZippedProjectDB(ExportType type) throws IOException {
		if ( getLocalPropertiesService().isUsingSqliteDB()) {
			ZipFile zippedSaiku = CollectEarthUtils.addFileToZip(
					getZippedProjectDB( type ), 
					getRdbExporter().getRdbFile( type ),
					getRdbExporter().getRdbFile( type ).getName()
				);
			zippedSaiku.close();
		}
	}

	protected String getSchemaName() {
		if (getLocalPropertiesService().isUsingPostgreSqlDB()) {
			return EarthConstants.POSTGRES_RDB_SCHEMA_SAIKU;
		} else {
			return null;
		}
	}

	public void setRefreshDatabase(boolean refreshDatabase) {
		this.refreshDatabase = refreshDatabase;
	}

	public void setUserCancelledOperation(boolean userCancelledOperation) {
		this.userCancelledOperation = userCancelledOperation;
	}

	public boolean isRdbAlreadyGenerated(ExportType type) {

		boolean saikuDBAlreadyPresent = false;
		if (getLocalPropertiesService().isUsingSqliteDB()) {
			File rdbFile = getZippedProjectDB( type );
			saikuDBAlreadyPresent = rdbFile.exists();
		} else {
			// Here we should check if the "rdbcollectearth" schema is created in the
			// PostgreSQL database
			saikuDBAlreadyPresent = true;
		}

		return saikuDBAlreadyPresent;
	}
	
	boolean restoreZippedProjectDB( ExportType type ) {
		boolean restoredSaiku = false;
		if (getZippedProjectDB( type ).exists()) {
			// Unzip file

			try (ZipFile zippedProjectSaikuData = new ZipFile(getZippedProjectDB( type ))) {
				zippedProjectSaikuData.extractAll(FolderFinder.getCollectEarthDataFolder());
				restoredSaiku = true;
			} catch (IOException e) {
				logger.error("Problems unzipping the contents of the zipped Saiku DB to the local user folder ", e);
			}

		}
		return restoredSaiku;
	}
	
	private String getRdbFilePrefix( ExportType type ) {
		String result = "";
		try {
			final MessageDigest messageDigest = MessageDigest.getInstance("MD5");
			messageDigest.reset();
			String concatenation = getEarthSurveyService().getCollectSurvey().getUri()
					+ getEarthSurveyService().getCollectSurvey().getName();
			messageDigest.update(concatenation.getBytes( StandardCharsets.UTF_8 ) );
			final byte[] resultByte = messageDigest.digest();
			result = new String(Hex.encodeHex(resultByte));
		} catch (NoSuchAlgorithmException e) {
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
}