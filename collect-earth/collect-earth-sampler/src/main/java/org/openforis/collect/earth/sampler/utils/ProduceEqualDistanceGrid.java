package org.openforis.collect.earth.sampler.utils;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

import org.apache.commons.io.FileUtils;
import org.geotools.referencing.GeodeticCalculator;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.locationtech.jts.geom.Coordinate;
import org.openforis.commons.io.csv.CsvWriter;
import org.opengis.referencing.operation.TransformException;

public class ProduceEqualDistanceGrid {

	public static void main(String[] args) {

		Coordinate northWest = new Coordinate( -100, 80);
		Coordinate	 southEast = new Coordinate( 100, -80);
		Float distanceInMeters = 100000f;

		ProduceEqualDistanceGrid equalDistanceGrid = new ProduceEqualDistanceGrid();
		try {

			File csvFile = equalDistanceGrid.getEqualDistanceGridInMeters( northWest, southEast, distanceInMeters );			
			FileUtils.copyFile(csvFile, new File("equalDistance.csv") );
			System.out.println( csvFile.getAbsolutePath() );

		} catch (Exception e) {
			e.printStackTrace();
		}finally{
			System.exit(0);
		}
	}
	GeodeticCalculator calc = new GeodeticCalculator(DefaultGeographicCRS.WGS84);


	private File getEqualDistanceGridInMeters( Coordinate northWest, Coordinate southEast, Float distanceInMeters) throws IOException, TransformException{
		File output = File.createTempFile("grid", ".csv");

		try(
				FileWriter writer = new FileWriter(output);
				CsvWriter csvWriter = new CsvWriter(writer);
				){
			writer.write("# Grid with eqaully distanced latlong coordinates with a distance of "+ distanceInMeters);
			writer.write("# North-west point lat: "+ northWest.y +"  - long " + northWest.x);
			writer.write("# South-east point lat: "+ southEast.y +"  - long " + southEast.x);


			double northBoundary = northWest.y;
			double westBoundary = northWest.x;

			csvWriter.writeHeaders( new String[]{"id", "latitude", " longitude", "cosino_latitude/weight", "row", "column"} );

			Coordinate currentPoint = new Coordinate( westBoundary, northBoundary);
			Coordinate startingOfRow = currentPoint;
			String[] csvValues = new String[6];
			int id = 0;
			int row = 0;

			// The points will go first south, then east!!

			while( isWithinLatidude(currentPoint, northWest, southEast) ){

				int column = 0;

				while( isWithinLongitude(currentPoint, northWest, southEast) ){
					csvValues[0] = id+"";
					csvValues[1] = currentPoint.y+"";
					csvValues[2] = currentPoint.x+"";
					csvValues[3] = Math.cos( currentPoint.y )+"";
					csvValues[4] = row+"";
					csvValues[5] = column+"";

					csvWriter.writeNext( csvValues );
					column++;
					id++;

					// Move southwards
					currentPoint = CoordinateUtils.getPointWithOffset( startingOfRow, distanceInMeters * row, -1 * distanceInMeters * column );
				}

				// Move eastwards
				row++;
				currentPoint = CoordinateUtils.getPointWithOffset( startingOfRow, distanceInMeters * row, 0 );

			}

		}

		return output;

	}



	private boolean isWithinLatidude(Coordinate currentPoint,
			Coordinate northWest, Coordinate southEast) {

		double latiude = currentPoint.y;
		return ( latiude <northWest.y && latiude > southEast.y);

	}

	private boolean isWithinLongitude(Coordinate currentPoint,
			Coordinate northWest, Coordinate southEast) {

		double longitude = currentPoint.x;		
		return ( longitude >northWest.x && longitude < southEast.x);		
	}


}
