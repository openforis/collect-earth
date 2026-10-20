package org.openforis.collect.earth.grid;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import org.apache.commons.io.IOUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class JDBCStore extends AbstractStore {

	private int count = 0;
	private int distanceBetweenPlots;
	Connection connection = null;
	private PreparedStatement insertStatement;
	private PreparedStatement selectStatement;
	private PreparedStatement allStatement;
	private Logger logger = LoggerFactory.getLogger(JDBCStore.class);

	public static final int SCALING_FACTOR = 10000000;

	private static final Boolean USE_SQLITE = false;

	private static final String SQLITE_URL = "jdbc:sqlite:";
	private static final String POSTGRESQL_URL = "jdbc:postgresql://localhost/sigrid";
	private static final String DB_USER_PROPERTY = "sigrid.db.user";
	private static final String DB_PASSWORD_PROPERTY = "sigrid.db.password";

	/** The results are read row by row rather than all at once, a full grid does not fit in memory */
	private static final int FETCH_SIZE = 5000;

	private Connection getConnection() throws SQLException {
		if (connection == null || connection.isClosed()) {
			// A failure is thrown to the caller : it used to be logged and null returned, so every caller died on a
			// NullPointerException that said nothing about the connection. JDBC 4 drivers register themselves, so there
			// is no driver class to load either.
			File sigridDBFile = new File("sigrid.db");
			if (Boolean.TRUE.equals(USE_SQLITE)) {
				connection = DriverManager.getConnection(SQLITE_URL + sigridDBFile.getAbsolutePath());
			} else {
				// The credentials are not kept in the source code ( this is a public repository )
				final String user = System.getProperty(DB_USER_PROPERTY);
				final String password = System.getProperty(DB_PASSWORD_PROPERTY);
				if (user == null || password == null) {
					throw new SQLException("Set the database credentials when launching : -D" + DB_USER_PROPERTY
							+ "=... -D" + DB_PASSWORD_PROPERTY + "=...");
				}
				connection = DriverManager.getConnection(POSTGRESQL_URL, user, password);
			}
			// Without this the driver keeps every row of a query in memory before the first one is read
			connection.setAutoCommit(false);
		}
		return connection;
	}

	@Override
	public void initializeStore(int distanceBetweenPlots) throws Exception {
		this.distanceBetweenPlots = distanceBetweenPlots;
		createTable();
	}

	private void createTable() throws IOException, SQLException {
		final String scriptName = Boolean.TRUE.equals(USE_SQLITE) ? "createTableSqlite.sql" : "createTable.sql";
		final String createTable;
		// Read as a stream : as a File it throws "URI is not hierarchical" as soon as this module runs from its jar
		try (InputStream script = this.getClass().getClassLoader().getResourceAsStream(scriptName)) {
			if (script == null) {
				throw new IOException("The script " + scriptName + " is not in the classpath");
			}
			createTable = IOUtils.toString(script, StandardCharsets.UTF_8);
		}
		try (Statement createStatement = getConnection().createStatement();) {
			createStatement.executeUpdate(createTable);
		}
		getConnection().commit();
	}

	private PreparedStatement getInsertStatement() throws SQLException {
		if (insertStatement == null) {
			String sql = "INSERT INTO plot( griddistance, row, col, gridflags, xcoordinate, ycoordinate ) "
					+ "VALUES(?,?,?,?,?,?)";
			insertStatement = getConnection().prepareStatement(sql);
		}
		return insertStatement;
	}

	/*
	 * The subgrid is selected on the row and the column, which is what belonging to a subgrid means, rather than on a bit of
	 * gridflags. The flag of a subgrid used to be 1 << distance, and an int has 32 bits : the grids of 50 and 100 landed on
	 * the bits of other grids, and the predicate " gridflags & ? = ? " returned the wrong plots for them. Reading the row and
	 * the column also gives the same answer for the rows written by the older, broken encoding.
	 */
	private PreparedStatement getSelectStatement() throws SQLException {
		if (selectStatement == null) {
			String sql = "SELECT * FROM plot" + " WHERE " + " xcoordinate<? and ycoordinate<? " + " AND "
					+ " xcoordinate>=? and ycoordinate>=?" + " AND " + " griddistance = ? " + " AND "
					+ " \"row\" % ? = 0 and col % ? = 0";
			selectStatement = getConnection().prepareStatement(sql);
			selectStatement.setFetchSize(FETCH_SIZE);
		}
		return selectStatement;
	}

	private PreparedStatement getAllStatement() throws SQLException {
		// Its own field : both queries were cached in selectStatement, so whichever was asked for second answered with the
		// SQL of the first and its bound parameters
		if (allStatement == null) {
			String sql = "SELECT * FROM plot" + " WHERE " + " griddistance = ? " + " AND "
					+ " \"row\" % ? = 0 and col % ? = 0";
			allStatement = getConnection().prepareStatement(sql);
			allStatement.setFetchSize(FETCH_SIZE);
		}
		return allStatement;
	}

	@Override
	public void savePlot(Double latitude, Double longitude, Integer row, Integer column) {

		final int gridFlags = getGridFlags(row, column);

		try {

			getInsertStatement().setInt(1, distanceBetweenPlots);
			getInsertStatement().setInt(2, row);
			getInsertStatement().setInt(3, column);
			getInsertStatement().setInt(4, gridFlags);
			// Rounded in double precision : through a float the coordinate lost about a metre near the poles
			getInsertStatement().setInt(5, Math.toIntExact(Math.round(longitude * SCALING_FACTOR)));
			getInsertStatement().setInt(6, Math.toIntExact(Math.round(latitude * SCALING_FACTOR)));

			getInsertStatement().addBatch();
			count++;
			// execute every 100 rows or less
			if (count % 50000 == 0) {
				logger.info("Flushing to DB " + count);
				getInsertStatement().executeBatch();
				getConnection().commit();
			}
		} catch (SQLException e) {
			// Each batch holds up to 50000 plots : carrying on left holes in the grid that nothing downstream could notice
			throw new IllegalStateException("Error inserting the plots into the database", e);
		}

	}

	public ResultSet getPlots(Integer grid, Double maxX, Double maxY, Double minX, Double minY, Integer distance)
			throws SQLException {

		getSelectStatement().setInt(1, Math.toIntExact(Math.round(maxX * SCALING_FACTOR)));
		getSelectStatement().setInt(2, Math.toIntExact(Math.round(maxY * SCALING_FACTOR)));
		getSelectStatement().setInt(3, Math.toIntExact(Math.round(minX * SCALING_FACTOR)));
		getSelectStatement().setInt(4, Math.toIntExact(Math.round(minY * SCALING_FACTOR)));
		getSelectStatement().setInt(5, distance);
		getSelectStatement().setInt(6, grid);
		getSelectStatement().setInt(7, grid);

		logger.info(getSelectStatement().toString());
		return getSelectStatement().executeQuery();
	}

	public ResultSet getAllPlots(Integer grid, Integer distance) throws SQLException {

		getAllStatement().setInt(1, distance);
		getAllStatement().setInt(2, grid);
		getAllStatement().setInt(3, grid);

		logger.info(getAllStatement().toString());
		return getAllStatement().executeQuery();
	}

	@Override
	public void closeStore() {
		// The fields, not the getters : asking for them opened a connection and prepared the statements again, only to
		// close them, and threw when the store had never been opened at all
		try {
			if (insertStatement != null) {
				insertStatement.executeBatch();
				connection.commit();
			}
		} catch (SQLException e) {
			logger.error("Error writing the last plots into the database", e);
		}

		closeQuietly(insertStatement);
		closeQuietly(selectStatement);
		closeQuietly(allStatement);
		insertStatement = null;
		selectStatement = null;
		allStatement = null;

		try {
			if (connection != null && !connection.isClosed()) {
				connection.close();
			}
		} catch (SQLException e) {
			logger.error("Error closing connection", e);
		}
		connection = null;
	}

	private void closeQuietly(PreparedStatement statement) {
		if (statement == null) {
			return;
		}
		try {
			statement.close();
		} catch (SQLException e) {
			logger.error("Error closing a statement", e);
		}
	}

}
