package org.openforis.collect.earth.app.service;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController;

public enum ExportType {
    SAIKU( 
    		ServerController.SAIKU_RDB_SUFFIX, 
    		"Saiku", 
    		"SaikuDataFolder", 
    		EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB + ServerController.SAIKU_RDB_SUFFIX, 
    		EarthConstants.POSTGRES_RDB_SCHEMA_SAIKU
    	), 
    IPCC(  
    		ServerController.IPCC_RDB_SUFFIX, 
    		"Ipcc", 
    		"IPCCDataFolder", 
    		EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB + ServerController.IPCC_RDB_SUFFIX, 
    		EarthConstants.POSTGRES_RDB_SCHEMA_IPCC
    	);
    
    private String dbSuffix;
	private String prefix;
	private String dataFolder;
	private String dbFileName;
	private String rdbSchema;
	
    ExportType(String dbSuffix, String prefix, String dataFolder, String dbFileName, String rdbSchema ) {
    	this.dbSuffix = dbSuffix;
    	this.prefix = prefix;
    	this.dataFolder = dataFolder;
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