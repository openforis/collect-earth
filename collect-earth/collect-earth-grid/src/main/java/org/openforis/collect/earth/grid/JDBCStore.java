package org.openforis.collect.earth.grid;

import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.charset.Charset;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;

import org.apache.commons.io.FileUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class JDBCStore extends AbstractStore{
	int count =0;

	private int distanceBetweenPlots;
	Connection connection = null;
	private PreparedStatement preparedStatement;
	private Logger logger = LoggerFactory.getLogger(JDBCStore.class); 
	@Override
	public void initializeStore(int distanceBetweenPlots) throws Exception {
		Class.forName("org.postgresql.Driver");

		connection = DriverManager.getConnection(
				"jdbc:postgresql://localhost/globalgridJDBC","collectearth", "collectearth");

		this.distanceBetweenPlots = distanceBetweenPlots;
		
		createTable();
		
		
	}
	
	
	private void createTable() throws IOException, SQLException, URISyntaxException {
		String createTable = FileUtils.readFileToString( 
				new File( this.getClass().getClassLoader().getResource("createTable.sql").toURI() ),
				Charset.forName("UTF-8") 
			);
		Statement createStatement = connection.createStatement();
		createStatement.executeUpdate(createTable);
	}
	

	private PreparedStatement getStatement() throws SQLException {
		if( preparedStatement == null ) {
			String SQL = "INSERT INTO plot( griddistance, row, col, gridflags, xcoordinate, ycoordinate, xoffset, yoffset ) "
					+ "VALUES(?,?,?,?,?,?,?,?)";
			preparedStatement=  connection.prepareStatement(SQL);
		}
		return preparedStatement;
	}

	@Override
	public void savePlot(Double latitude, Double longitude, Integer yOffset, Integer xOffset, Integer row,
			Integer column) {

		int gridFlags = 0;
		for (Integer d : getDistances()) {
			if (column%d + row%d == 0) {
				gridFlags = gridFlags | (1<<d);
			}
		}
		
		
		try {

			getStatement().setInt(1, distanceBetweenPlots );
			getStatement().setInt(2, row );
			getStatement().setInt(3, column );
			getStatement().setInt(4, gridFlags );
			getStatement().setDouble(5, longitude);
			getStatement().setDouble(6, latitude );
			getStatement().setInt(7, xOffset );
			getStatement().setInt(8, yOffset );
			
			getStatement().addBatch();
			count++;
			// execute every 100 rows or less
			if (count % 1000 == 0 ) {
				System.out.println( "FLushing to DB " );
				getStatement().executeBatch();
			}
	} catch (SQLException e) {
		logger.error( "Error inserting data", e);
	}

}

@Override
public void closeStore() {
	try {
		getStatement().executeBatch();
		connection.close();
	} catch (SQLException e) {
		logger.error( "Error closing connection", e);
	}
}


}
