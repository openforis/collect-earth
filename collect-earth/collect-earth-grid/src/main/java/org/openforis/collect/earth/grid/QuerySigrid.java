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

	// Bounding box array : Double maxX, Double maxY, Double minX, Double minY
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
			//logger.error("Error readig results from DB", e);
		} finally {
			csv.closeStore();
			database.closeStore();
		}
	}

	public static void main(String[] args) {
		QuerySigrid querySigrid = new QuerySigrid();
		//Double East, Double North, Double West, Double South
		//querySigrid.writeCsvFromBoundingBox( new Double[] {38d,38d,-17d,14d}, 1000, 10, "NorthAfrica");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {60d,38d,-17d,-35d}, 1000, 10, "AllAfricaAfrica");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {11.7d, 37.5d, 7.2d, 30d}, 1000, 1, "Tunisia_1000");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {6.034, 14.862, 1.687, 12.725}, 1000, 1, "FFEM_1000");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {34.434541, -7.869966, 21.344595, -18.697429}, 1000, 1, "Zambia");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {30.88, -2.3, 28.98, -4.5}, 1000, 1, "Burundi");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {29.8, -28.5, 26.7, -30.8}, 1000, 1, "Lesotho");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {47.1, 43.7, 39.8, 40.8}, 1000, 1, "Georgia");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {43.6, 12.8, 41.49, 10.77}, 1000, 1, "Djibouti");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {4.2, 13.25, -3.88, 4.29}, 1000, 5, "Ghanna_5x5");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {-11.0, 17.0, -17.8, 10.39}, 1000, 1, "Senegal");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {36.15d, -5.51d, 11.38d, -29.09d}, 1000, 1, "Namibia_Zambia_Zimbawe_Malawi_Botswana");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {32.17d, -25.62d, 30.7d, -27.5d}, 1000, 1, "Eswatini");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {30.92d, -1d, 28.78d, -2.93d}, 1000, 1, "Rwanda");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {35.13d, 4.34d, 29.49d, -1.56d}, 1000, 2, "Uganda");
		//querySigrid.writeCsvFromBoundingBox( new Double[] {50.8d, 42d, 44.5d, 38.2d}, 1000, 1, "Azerbaijan");
		querySigrid.writeCsvFromBoundingBox( new Double[] {1.36d, 11.28d, -3.37d, 4.64d}, 1000, 1, "Ghana");
		System.exit(0);
	}
}
