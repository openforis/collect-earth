package org.openforis.collect.earth.app.service;

import java.sql.Connection;

import javax.sql.DataSource;

import org.apache.commons.dbcp2.BasicDataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceUtils;

public abstract class RDBConnector {
	@Autowired
	@Qualifier("rdbDataSource")
	private DataSource rdbDataSource;
	
	@Autowired
	@Qualifier("rdbDataSourceIpcc")
	private BasicDataSource rdbDataSourceIpcc;
	
	private JdbcTemplate jdbcTemplate;
	
	private ExportType exportTypeUsed;
	
	public JdbcTemplate getJdbcTemplate() {
		if( jdbcTemplate == null ) {
			if( getExportTypeUsed().equals( ExportType.SAIKU) ) {
				jdbcTemplate = new JdbcTemplate(rdbDataSource);
			}else if( getExportTypeUsed().equals( ExportType.IPCC ) ){
				jdbcTemplate = new JdbcTemplate(rdbDataSourceIpcc);
			}else {
				throw new IllegalArgumentException("The ExportType has not been set yet");
			}
		}
		return jdbcTemplate;
	}
	
	protected Connection getJDBCConnection() {
		if( getExportTypeUsed().equals( ExportType.SAIKU ) ) {
			return DataSourceUtils.getConnection(rdbDataSource);
		}else if( getExportTypeUsed().equals( ExportType.IPCC ) ){
			return DataSourceUtils.getConnection(rdbDataSourceIpcc);
		}else {
			throw new IllegalArgumentException("The ExportType has not been set yet");
		}
	}

	public ExportType getExportTypeUsed() {
		return exportTypeUsed;
	}

	public void setExportTypeUsed(ExportType exportTypeUsed) {
		this.exportTypeUsed = exportTypeUsed;
	}

}
