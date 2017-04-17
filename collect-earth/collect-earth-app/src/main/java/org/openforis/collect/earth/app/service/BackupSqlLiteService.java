package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;

import javax.annotation.PostConstruct;

import net.lingala.zip4j.exception.ZipException;

import org.apache.commons.dbcp.BasicDataSource;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
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

	private static final String BACKUP_COLLECT_EARTH = "backupSqlite"; //$NON-NLS-1$

	private static final int MAXIMUM_NUMBER_OF_BACKUPS = 10;
	
	@Autowired
	BasicDataSource dataSource;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private Logger logger = LoggerFactory.getLogger( BackupSqlLiteService.class );

	@PostConstruct
	public void init() throws FileNotFoundException {
		attachShutDownHook();
	}

	private void attachShutDownHook() {
		Runtime.getRuntime().addShutdownHook(new Thread() {
			@Override
			public void run() {
				if ( "true".equals(localPropertiesService.getValue(EarthProperty.AUTOMATIC_BACKUP) ) ) { //$NON-NLS-1$
					automaticDBBackup();
				}
			}

		});
	}

	private void automaticDBBackup() {
		if( localPropertiesService.isUsingSqliteDB() ){
			
			String pathToBackupZip = ""; //$NON-NLS-1$
			
			String nameCollectDB = EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB;
			File originalDBFile = new File(nameCollectDB);

			try {
				// DON"T USE THIS
				// This generates a file with name "\Users\USERNAME\AppData\Roaming\CollectEarth\collectEarthDatabase.db"
				// which generates a folder within the backup folder
				//nameCollectDB = getCollectDBName(); 


				
				pathToBackupZip = getBackupZipFilename();
				
				CollectEarthUtils.addFileToZip(pathToBackupZip, originalDBFile, EarthConstants.COLLECT_EARTH_DATABASE_FILE_NAME);

				removeExtraBackups();

			} catch (IOException e) {
				logger.error("Error when create backup of the Collect Earth Database from " + nameCollectDB + " to " + pathToBackupZip, e); //$NON-NLS-1$ //$NON-NLS-2$
			} catch (ZipException e) {
				logger.error("Error when zipping the Collect Earth Database from " + nameCollectDB + " to " + pathToBackupZip, e); //$NON-NLS-1$ //$NON-NLS-2$			
			}
		}
	}

	private String getBackupZipFilename() throws IOException {
		
		File backupFolder = getAutomaticBackUpFolder();
		String pathToBackup = getDBCopyName(backupFolder);
		return pathToBackup;
		
	}

	public String getDBCopyName(File backupFolder) throws IOException {
		String pathToBackup;
		SimpleDateFormat sdf = new SimpleDateFormat("yyyy_MM_dd_HHmmss"); //$NON-NLS-1$
		StringBuilder destPathStr = new StringBuilder();
		destPathStr.append(backupFolder.getCanonicalPath());
		destPathStr.append(File.separatorChar);
		destPathStr.append( EarthConstants.COLLECT_EARTH_DATABASE_FILE_NAME);
		destPathStr.append(sdf.format( new Date() )).append( ".zip");
		pathToBackup = destPathStr.toString();
		return pathToBackup;
	}

	private void removeExtraBackups() {

		File backupFolder = getAutomaticBackUpFolder();

		File[] files = backupFolder.listFiles();
		if( files!=null && files.length > MAXIMUM_NUMBER_OF_BACKUPS ){

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
	public File getAutomaticBackUpFolder() {
		return FolderFinder.createFolderInAppData( BACKUP_COLLECT_EARTH);
	}
	
}
