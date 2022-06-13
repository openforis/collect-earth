package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import javax.swing.SwingUtilities;

import org.apache.commons.dbcp.BasicDataSource;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.collect.earth.core.rdb.RelationalSchemaContext;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
import org.openforis.collect.relational.model.RelationalSchemaConfig;
import org.openforis.idm.metamodel.Survey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class RDBExporter {
	
	@Autowired
	CollectRDBPublisher collectRDBPublisher;

	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	public LocalPropertiesService localPropertiesService;
	
	@Autowired
	private BasicDataSource rdbDataSource;
	
	private final Logger logger = LoggerFactory.getLogger(RDBExporter.class);
	
	public static final String COLLECT_EARTH_IPCC_DATABASE_RDB_DB = 
			EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB
			+ "ipccData";
	public static final String COLLECT_EARTH_SAIKU_DATABASE_RDB_DB = EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB
			+ ServerController.SAIKU_RDB_SUFFIX;

	private boolean userCancelledOperation = false;
	
	public enum ExportType {
	    SAIKU( ServerController.SAIKU_RDB_SUFFIX, "Saiku", "SaikuDataFolder", EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB + ServerController.SAIKU_RDB_SUFFIX, EarthConstants.POSTGRES_RDB_SCHEMA_SAIKU), 
	    IPCC(  ServerController.IPCC_RDB_SUFFIX, "Ipcc", "IPCCDataFolder", EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB + ServerController.IPCC_RDB_SUFFIX, EarthConstants.POSTGRES_RDB_SCHEMA_IPCC);
	    
	    private String dbSuffix;
		private String prefix;
		private String dataFolder;
		private String dbFileName;
		private String rdbSchema;
		
	    ExportType(String dbSuffix, String prefix, String dataFolder, String dbFileName, String rdbSchema ) {
	    	this.dbSuffix = dbSuffix;
	    	this.prefix = prefix;
	    	this.dbFileName = dbFileName;
	    	this.rdbSchema = rdbSchema;
	    }

		public String getDbSuffix() {
			return dbSuffix;
		}

		public String getPrefix() {
			return prefix;
		}
		
		public String getDataFolder() {
			return dataFolder;
		}

		public String getDbFileName() {
			return dbFileName;
		}
		
		public String getRdbSchema() {
			return rdbSchema;
		}

	}
	
	private JdbcTemplate jdbcTemplate;
	
	public JdbcTemplate getJdbcTemplate() {
		if( jdbcTemplate == null ) {
			jdbcTemplate = new JdbcTemplate(rdbDataSource);
		}
		return jdbcTemplate;
	}
	
	private void removeOldRdb( ExportType exportType ) {

		final List<String> tables = new ArrayList<>();

		if (localPropertiesService.isUsingSqliteDB()) {

			cleanSqlLiteDb(exportType, tables);

		} else if (localPropertiesService.isUsingPostgreSqlDB()) {
			cleanPostgresDb(exportType);

		}

	}
	
	private void cleanPostgresDb( ExportType exportType ) {
		getJdbcTemplate().execute("DROP SCHEMA IF EXISTS " + exportType.getRdbSchema() + " CASCADE"); //$NON-NLS-1$ //$NON-NLS-2$
		getJdbcTemplate().execute("CREATE SCHEMA IF NOT EXISTS " + exportType.getRdbSchema() ); //$NON-NLS-1$
	}

	public File getRdbFile( ExportType exportType) {
		return new File(exportType.getDbFileName());
	}
	
	private void cleanSqlLiteDb( ExportType exportType, final List<String> tables) {
		final File oldRdbFile = getRdbFile( exportType ) ;
		if (oldRdbFile.exists()) {

			// Now we can remove the SQLite file so that a completely new connection is open
			try {
				Files.delete( Paths.get( oldRdbFile.toURI() ) );
			} catch (IOException e1) {
				logger.error("Error deleteing old Relational DB sqlite file", e1);

				// We need to delete all tables before we can remove the file and drop the
				// connection
				final List<Map<String, Object>> listOfTables = getJdbcTemplate()
						.queryForList("SELECT name FROM sqlite_master WHERE type='table' OR type ;"); //$NON-NLS-1$
				for (final Map<String, Object> entry : listOfTables) {
					final String tableName = (String) entry.get("name"); //$NON-NLS-1$
					if (!tableName.equals("sqlite_sequence")) { //$NON-NLS-1$
						tables.add(tableName);
					}
				}

				for (final String tableName : tables) {
					getJdbcTemplate().execute("DROP TABLE IF EXISTS " + tableName); //$NON-NLS-1$
				}

				// DROP VIEWS!
				final List<Map<String, Object>> listOfViews = getJdbcTemplate()
						.queryForList("SELECT name FROM sqlite_master WHERE type = 'view';"); //$NON-NLS-1$
				for (final Map<String, Object> entry : listOfViews) {
					final String viewName = (String) entry.get("name"); //$NON-NLS-1$
					getJdbcTemplate().execute("DROP VIEW IF EXISTS " + viewName); //$NON-NLS-1$
				}
				try {
					if( getJdbcTemplate().getDataSource() != null && getJdbcTemplate().getDataSource().getConnection() != null){
						getJdbcTemplate().getDataSource().getConnection().close();
					}
				} catch (CannotGetJdbcConnectionException | SQLException e2) {
					logger.error("Error closing the DB collection", e2);
				}
				// Now we can remove the SQLite file so that a completely new connection is open
				try {
					Files.delete( Paths.get( oldRdbFile.toURI() ) );
				} catch (IOException e3) {
					logger.error("Error deleteing old Saiku DB sqlite file", e3);
				}
			}


			if (!SystemUtils.IS_OS_WINDOWS) {
				try {
					Thread.yield();
					Thread.sleep(10000);
				} catch (InterruptedException e) {
					logger.error("Error while giving pass to other processes", e);
					 Thread.currentThread().interrupt();
				}
			}


		}

	}


	public String getSchemaName( ExportType exportType ) {
		if (localPropertiesService.isUsingPostgreSqlDB()) {
			return exportType.getRdbSchema();
		} else {
			return null;
		}
	}
	
	public void exportDataToRDB(
			Survey survey, 
			ExportType exportType, 
			InfiniteProgressMonitor progressListener,
			RDBPostProcessor callbackProcessor ) throws CollectRdbException {
		
		// Clean the previous RDB
		removeOldRdb( exportType );
		
		/*
		 * The SQLite DB has no limit on the length of the varchar. By default, if no
		 * RelationalSchemaConfig is passed to the export command text fields will be
		 * truncated to 255 characters
		 */
		final RelationalSchemaConfig rdbConfig = new RelationalSchemaContext().getRdbConfig();

		final String rdbSaikuSchema = getSchemaName( exportType );

		SwingUtilities.invokeLater( () -> progressListener.setMessage("Exporting collected records into Relational DB") );

		collectRDBPublisher.export( survey.getName(), 
				EarthConstants.ROOT_ENTITY_NAME,
				Step.ENTRY, 
				rdbSaikuSchema, 
				rdbConfig, 
				progressListener);

		if (!isUserCancelledOperation()) {
			System.currentTimeMillis();
			try {
				callbackProcessor.processRDBData(progressListener);
				setJDBCDefaultSchema( exportType);
			} catch (final Exception e) {
				logger.error("Error processing quantity data", e); //$NON-NLS-1$
			}
		}
	}
	
	private void setJDBCDefaultSchema( ExportType exportType ) {
		if (localPropertiesService.isUsingPostgreSqlDB()) {
			getJdbcTemplate().execute("SET search_path TO " + getSchemaName( exportType )); //$NON-NLS-1$
		}
	}

	private boolean isUserCancelledOperation() {
		return userCancelledOperation;
	}

}
