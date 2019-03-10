package org.openforis.collect.earth.grid;

import java.io.File;
import java.sql.ResultSet;
import java.sql.SQLException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class QuerySigrid {

	JDBCStore database = new JDBCStore();
	CSVStore csv = new CSVStore();
	private Logger logger = LoggerFactory.getLogger(this.getClass());
	
	public ResultSet getSigridForShapefile( File shapefile, Integer gridDistance, Integer grid ){
		return null;
	}

	public ResultSet getSigridForBoundingBox( Double[] boundingBox, Integer gridDistance, Integer grid ){
		return database.getPlots(grid, boundingBox[0], boundingBox[1], boundingBox[2], boundingBox[3], gridDistance);
	}


	public void writeCsvFromBoundingBox( Double[] boundingBox, Integer gridDistance, Integer grid, String prefix  ) {


		ResultSet results = getSigridForBoundingBox(boundingBox, gridDistance, grid);
		csv.initializeStore(gridDistance, prefix);
		try {
			while(results.next()) {
				csv.savePlot(
						results.getInt("ycoordinate") * 1d /JDBCStore.SCALING_FACTOR *1d, 
						results.getInt("xcoordinate") * 1d  /JDBCStore.SCALING_FACTOR * 1d , 
						results.getInt("row"), 
						results.getInt("col")
						);
			}
		} catch (SQLException e) {
			logger.error("Error readig results from DB", e);
		} finally {
			csv.closeStore();
		}
	}

	public static void main(String[] args) {
		QuerySigrid querySigrid = new QuerySigrid();
		querySigrid.writeCsvFromBoundingBox( new Double[] {2d,43d,-10d,35d}, 30000, 8, "Spain");
	}
}
