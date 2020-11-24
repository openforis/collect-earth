package org.openforis.collect.earth.grid;

import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import org.apache.commons.io.FileUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class JDBCStore extends AbstractStore{

	private int count = 0;
	private int distanceBetweenPlots;
	Connection connection = null;
	private PreparedStatement insertStatement;
	private PreparedStatement selectStatement;
	private Logger logger = LoggerFactory.getLogger(JDBCStore.class);

	public static final int SCALING_FACTOR = 10000000;

	private static final Boolean USE_SQLITE = false;

	private static final String SQLITE_URL = "jdbc:sqlite:";
	private static final String POSTGRESQL_URL = "jdbc:postgresql://localhost/sigrid";

	private Connection getConnection() {
		if(connection == null ) {
			try {
				Class.forName("org.sqlite.JDBC");
				File sigridDBFile = new File( "sigrid.db" );
				connection = DriverManager.getConnection( Boolean.TRUE.equals(USE_SQLITE) ? SQLITE_URL+sigridDBFile.getAbsolutePath() : POSTGRESQL_URL, "collectearth","collectearth");
			} catch (Exception e) {
				logger.error("Error loading JDBC driver", e);
			}
		}
		return connection;
	}

	@Override
	public void initializeStore(int distanceBetweenPlots) throws Exception {
		this.distanceBetweenPlots = distanceBetweenPlots;
		createTable();
	}



	private void createTable() throws IOException, SQLException, URISyntaxException, ClassNotFoundException {
		String createTable = FileUtils.readFileToString(
				new File( this.getClass().getClassLoader().getResource( Boolean.TRUE.equals(USE_SQLITE) ? "createTableSqlite.sql" : "createTable.sql" ).toURI() ),
				StandardCharsets.UTF_8
				);
		Statement createStatement = getConnection().createStatement();
		createStatement.executeUpdate(createTable);
	}


	private PreparedStatement getInsertStatement() throws SQLException {
		if( insertStatement == null ) {
			String sql = "INSERT INTO plot( griddistance, row, col, gridflags, xcoordinate, ycoordinate ) "
					+ "VALUES(?,?,?,?,?,?)";
			insertStatement=  getConnection().prepareStatement(sql);
		}
		return insertStatement;
	}

	private PreparedStatement getSelectStatement() throws SQLException {
		if( selectStatement == null ) {
			String sql = "SELECT * FROM plot"
					+ " WHERE "
					+ " xcoordinate<=? and ycoordinate<=? "
					+ " AND "
					+ " xcoordinate>=? and ycoordinate>=?"
					+ " AND "
					+ " griddistance = ? "
					+ " AND "
					+ " gridflags & ? = ?";
			selectStatement=  getConnection().prepareStatement(sql);
		}
		return selectStatement;
	}

	@Override
	public void savePlot(Double latitude, Double longitude, Integer row, Integer column) {

		int gridFlags = 0;
		for (Integer d : getDistances()) {
			if (column%d + row%d == 0) {
				gridFlags = gridFlags | (1<<d);
			}
		}

		try {

			getInsertStatement().setInt(1, distanceBetweenPlots );
			getInsertStatement().setInt(2, row );
			getInsertStatement().setInt(3, column );
			getInsertStatement().setInt(4, gridFlags );
			getInsertStatement().setInt(5, Math.round( longitude.floatValue() * SCALING_FACTOR ) );
			getInsertStatement().setInt(6, Math.round( latitude.floatValue()  * SCALING_FACTOR ) );

			getInsertStatement().addBatch();
			count++;
			// execute every 100 rows or less
			if (count % 50000 == 0 ) {
				logger.info( "Flushing to DB "+count );
				getInsertStatement().executeBatch();

			}
		} catch (SQLException e) {
			logger.error( "Error inserting data", e);
		}

	}


	public ResultSet getPlots(
			Integer grid,
				Double maxX, Double maxY,
				Double minX, Double minY,
				Integer distance
				) {

		int gridFlags =  (int) Math.pow(2, grid);
		ResultSet results = null;

		try {

			getSelectStatement().setInt(1, Math.round( maxX.floatValue() * SCALING_FACTOR ) );
			getSelectStatement().setInt(2, Math.round( maxY.floatValue() * SCALING_FACTOR ) );
			getSelectStatement().setInt(3, Math.round( minX.floatValue() * SCALING_FACTOR ) );
			getSelectStatement().setInt(4, Math.round( minY.floatValue() * SCALING_FACTOR ) );
			getSelectStatement().setInt(5, Math.round( distance.floatValue() ) );
			getSelectStatement().setInt(6, gridFlags );
			getSelectStatement().setInt(7, gridFlags );

			logger.info( getSelectStatement().toString() );
			results = getSelectStatement().executeQuery();

		} catch (SQLException e) {
			logger.error( "Error querying the DB data", e);
		}

		return results;
	}

	@Override
	public void closeStore() {
		try {
			if( getInsertStatement() != null ) {
				getInsertStatement().executeBatch();
			}

			if(getConnection()!=null ) {
				getConnection().close();
			}
		} catch (SQLException e) {
			logger.error( "Error closing connection", e);
		}
	}


}
