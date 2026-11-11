package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Field;
import java.sql.Connection;

import org.apache.commons.dbcp2.BasicDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.springframework.jdbc.core.JdbcTemplate;

/** The connection of the IPCC exports to their own database (RDBConnector), on an SQLite database in memory. */
public class RDBConnectorTest {

	private BasicDataSource dataSource;
	private RDBConnector connector;

	@BeforeEach
	public void connect() throws Exception {
		dataSource = new BasicDataSource();
		dataSource.setDriverClassName("org.sqlite.JDBC");
		dataSource.setUrl("jdbc:sqlite::memory:");
		connector = new RDBConnector() {
		};
		Field field = RDBConnector.class.getDeclaredField("rdbDataSourceIpcc");
		field.setAccessible(true);
		field.set(connector, dataSource);
		connector.setExportTypeUsed(ExportType.IPCC);
	}

	@AfterEach
	public void close() throws Exception {
		dataSource.close();
	}

	@Test
	public void theIpccExportUsesItsDatabase() throws Exception {
		assertEquals(ExportType.IPCC, connector.getExportTypeUsed());
		JdbcTemplate template = connector.getJdbcTemplate();
		assertNotNull(template);
		// made once, then kept
		assertSame(template, connector.getJdbcTemplate());
		assertEquals(Integer.valueOf(1), template.queryForObject("select 1", Integer.class));
		Connection connection = connector.getJDBCConnection();
		try {
			assertFalse(connection.isClosed());
		} finally {
			connection.close();
		}
	}

	@Test
	public void theIpccExportsNames() {
		ExportType ipcc = ExportType.IPCC;
		assertEquals(ServerController.IPCC_RDB_SUFFIX, ipcc.getDbSuffix());
		assertEquals("Ipcc", ipcc.getPrefix());
		assertEquals("IPCCDataFolder", ipcc.getDataFolder());
		assertEquals(EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB + ServerController.IPCC_RDB_SUFFIX, ipcc.getDbFileName());
		assertEquals(EarthConstants.POSTGRES_RDB_SCHEMA_IPCC, ipcc.getRdbSchema());
		assertTrue(ipcc.getDbFileName().endsWith(ipcc.getDbSuffix()));
	}
}
