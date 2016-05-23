package org.openforis.collect.earth.sampler.utils;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

import org.apache.commons.io.FileUtils;
import org.geotools.referencing.GeodeticCalculator;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.openforis.commons.io.csv.CsvWriter;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.vividsolutions.jts.geom.Coordinate;

public class ProduceEqualDistanceGrid {
	
	public static void main(String[] args) {
				
		Coordinate northWest = new Coordinate( 86, 51);
		Coordinate southEast = new Coordinate( 125, 39);
		Float distanceInMeters = 2000f;
		
		ProduceEqualDistanceGrid equalDistanceGrid = new ProduceEqualDistanceGrid();
		try {
			
			File csvFile = equalDistanceGrid.getEqualDistanceGridInMeters( northWest, southEast, distanceInMeters );			
			FileUtils.copyFile(csvFile, new File("equalDistance.csv") );
			
		} catch (Exception e) {
			e.printStackTrace();
		}finally{
			System.exit(0);
		}
	}

	private Logger logger = LoggerFactory.getLogger(this.getClass());
	GeodeticCalculator calc = new GeodeticCalculator(DefaultGeographicCRS.WGS84);

	
	private File getEqualDistanceGridInMeters( Coordinate northWest, Coordinate southEast, Float distanceInMeters) throws IOException, TransformException{
		File output = File.createTempFile("grid", ".csv");
		FileWriter writer = new FileWriter(output);
		
		writer.write("# Grid with eqaully distanced latlong coordinates with a distance of "+ distanceInMeters);
		writer.write("# North-west point lat: "+ northWest.y +"  - long " + northWest.x);
		writer.write("# South-east point lat: "+ southEast.y +"  - long " + southEast.x);
		
		
		double northBoundary = northWest.y;
		double westBoundary = northWest.x;
		
		CsvWriter csvWriter = new CsvWriter(writer);
		csvWriter.writeHeaders( new String[]{"id", "latitude", " longitude", "cosino_latitude/weight", "row", "column"} );
		
		Coordinate currentPoint = new Coordinate( westBoundary, northBoundary);
		Coordinate startingOfRow = currentPoint;
		String[] csvValues = new String[6];
		int id = 0;
		int row = 0;
		
		// The points will go first south, then east!!

		while( isWithinLongitude(currentPoint, northWest, southEast) ){
			
			int column = 0;
			
			while( isWithinLatidude(currentPoint, northWest, southEast) ){
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
				currentPoint = transformCoordinates( startingOfRow, distanceInMeters * row, -1 * distanceInMeters * column );
			}
			
			// Move eastwards
			row++;
			currentPoint = transformCoordinates( startingOfRow, distanceInMeters * row, 0 );
			
		}
		
		
		writer.close();
		csvWriter.close();
		return output;
		
	}

	
	protected Coordinate transformCoordinates(Coordinate originalLatLong, double offsetLongitudeMeters, double offsetLatitudeMeters)
			throws TransformException {
		Coordinate movedPointLatLong = null;
		try {

			if (offsetLatitudeMeters == 0 && offsetLongitudeMeters == 0) {
				return movedPointLatLong;
			} else {

				double longitudeDirection = 50; // EAST
				if (offsetLongitudeMeters < 0) {
					longitudeDirection = -100; // WEST
				}

				double latitudeDirection = 0; // NORTH
				if (offsetLatitudeMeters < 0) {
					latitudeDirection = 180; // SOUTH
				}

				calc.setStartingGeographicPoint( originalLatLong.x, originalLatLong.y);

				boolean longitudeChanged = false;
				if (offsetLongitudeMeters != 0) {
					calc.setDirection(longitudeDirection, Math.abs( offsetLongitudeMeters ) );
					longitudeChanged = true;
				}

				if (offsetLatitudeMeters != 0) {
					if (longitudeChanged) {
						// Move the point in the horizontal axis first, afterwards reset the point and move vertically
						final double[] firstMove = calc.getDestinationPosition().getCoordinate();
						calc.setStartingGeographicPoint(firstMove[0], firstMove[1]);
					}
					calc.setDirection(latitudeDirection, Math.abs( offsetLatitudeMeters ) );
				}

				double[] coordinate = calc.getDestinationPosition().getCoordinate();
				movedPointLatLong = new Coordinate(coordinate[0], coordinate[1]);
				
			}
		} catch (final Exception e) {
			logger.error(
					"Exception when moving point " + originalLatLong + " with offset longitude " + offsetLongitudeMeters
							+ " and latitude " + offsetLatitudeMeters, e);
			e.printStackTrace( System.out );
		}

		return movedPointLatLong;

	}
	
	private boolean isWithinLatidude(Coordinate currentPoint,
			Coordinate northWest, Coordinate southEast) {
		boolean withinBounds = true;
		double southBoundary = southEast.y;

		double latiude = currentPoint.y;
		
		if( latiude < southBoundary  ){
			withinBounds = false;
		}
				
		return withinBounds;
		
	}
	
	private boolean isWithinLongitude(Coordinate currentPoint,
			Coordinate northWest, Coordinate southEast) {

		boolean withinBounds = true;
		double eastBoundary = southEast.x;
		
		double longitude = currentPoint.x;
		
		if( longitude > eastBoundary  ){
			withinBounds = false;
		}
		
		return withinBounds;		
	}
	

}
