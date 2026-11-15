package org.openforis.collect.earth.app.desktop;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

import org.junit.jupiter.api.Test;

/** An office's new PostgreSQL: the schema Collect needs is made at start (docs/plans/2026-11-15-workflow-review.md). */
class ServerControllerSchemaTest {

	@Test
	void theCollectSchemaIsMadeWhenMissing() throws Exception {
		Connection connection = mock(Connection.class);
		Statement statement = mock(Statement.class);
		when(connection.createStatement()).thenReturn(statement);

		ServerController.ensureCollectSchema(connection);

		verify(statement).execute("CREATE SCHEMA IF NOT EXISTS collect");
		verify(statement).close();
	}

	@Test
	void aUserWhoMayNotMakeItDoesNotStopTheStart() throws Exception {
		Connection connection = mock(Connection.class);
		Statement statement = mock(Statement.class);
		when(connection.createStatement()).thenReturn(statement);
		when(statement.execute("CREATE SCHEMA IF NOT EXISTS collect")).thenThrow(new SQLException("permission denied for database office"));

		assertDoesNotThrow(() -> ServerController.ensureCollectSchema(connection));
	}
}
