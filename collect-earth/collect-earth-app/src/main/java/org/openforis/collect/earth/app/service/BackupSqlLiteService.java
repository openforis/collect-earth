package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;

import javax.annotation.PostConstruct;

import org.apache.commons.dbcp.BasicDataSource;
import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.persistence.SurveyImportException;
import org.openforis.idm.metamodel.xml.IdmlParseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

/**
 * Spring managed bean that handles the creation of backups of the Collect database.
 * The SQLite database file will be saved everytime the application closes.
 * A maximum of 10 copies (the last ten times the application was used) will be saved on the backupCollectEarth folder on the users application data folder (OS dependant).
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
@Lazy(false)
public class BackupSqlLiteService {

	private static final String BACKUP_COLLECT_EARTH = "backupSqlite";

	private static final int MAXIMUM_NUMBER_OF_BACKUPS = 10; 

	@Autowired
	BasicDataSource dataSource;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private Logger logger = LoggerFactory.getLogger( BackupSqlLiteService.class );

	@PostConstruct
	public void init() throws FileNotFoundException, IdmlParseException, SurveyImportException {
		attachShutDownHook();
	}

	private void attachShutDownHook() {
		Runtime.getRuntime().addShutdownHook(new Thread() {
			@Override
			public void run() {
				if (localPropertiesService.getValue(EarthProperty.AUTOMATIC_BACKUP) != null
						&& localPropertiesService.getValue(EarthProperty.AUTOMATIC_BACKUP).toLowerCase().trim().equals("true")) {
					backupDB();
				}
			}

		});
	}

	private void backupDB() {
		if( localPropertiesService.isUsingSqliteDB() ){
			String nameCollectDB = "";
			String pathToBackup = "";
			SimpleDateFormat sdf = new SimpleDateFormat("yyyy_MM_dd_HHmmss");

			try {
				nameCollectDB = getCollectDBName();

				File backupFolder = getBackUpFolder();

				File srcFile = new File(nameCollectDB);
				StringBuilder destPathStr = new StringBuilder();
				destPathStr.append(backupFolder.getCanonicalPath());
				destPathStr.append(File.separatorChar);
				destPathStr.append(nameCollectDB);
				destPathStr.append(sdf.format( new Date() ));

				File destFile  = new File(destPathStr.toString() );			

				FileUtils.copyFile(srcFile, destFile );

				removeExtraBackups();

			} catch (IOException e) {
				logger.error("Error when create backup of the Collect Earth Database from " + nameCollectDB + " to " + pathToBackup);
			}
		}
	}

	private void removeExtraBackups() {

		File backupFolder = getBackUpFolder();

		File[] files = backupFolder.listFiles();
		if( files.length > MAXIMUM_NUMBER_OF_BACKUPS ){

			Arrays.sort(files, new Comparator<File>() {

				@Override
				public int compare(File o1, File o2) {
					if( o1.lastModified() < o2.lastModified() ){
						return 1;
					}else if( o1.lastModified() == o2.lastModified() ){
						return 0;
					}else{
						return -1;
					}

				}
			});

			for( int i = MAXIMUM_NUMBER_OF_BACKUPS; i< files.length ; i++ ){
				files[i].delete();
			}

		}

	}

	/**
	 * Returns the folder where the backup copies should be placed.
	 * @return The OS dependent folder where the application should saved the backed up copies. 
	 */
	public File getBackUpFolder() {
		String backupFolderPath = FolderFinder.getLocalFolder().getAbsolutePath() + File.separatorChar + BACKUP_COLLECT_EARTH;
		File backupFolder = new File(backupFolderPath);
		backupFolder.mkdirs();
		return backupFolder;
	}

	private String getCollectDBName() {
		String nameCollectDB;
		nameCollectDB = dataSource.getUrl();
		int indexLastColon = nameCollectDB.lastIndexOf(':');
		// should look like jdbc:sqlite:collectEarthDatabase.db"
		nameCollectDB = nameCollectDB.substring(indexLastColon+1);
		return nameCollectDB;
	}
}
