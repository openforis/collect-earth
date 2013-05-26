package org.openforis.eye.generator.processor;

import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openforis.eye.generator.model.SimpleCoordinate;
import org.openforis.eye.generator.model.SimplePlacemarkObject;
import org.openforis.eye.generator.model.SimpleRegion;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;

public class MultiPointKmlGenerator extends KmlGenerator {

	public MultiPointKmlGenerator(String epsgCode) {
		super(epsgCode);
		// TODO Auto-generated constructor stub
	}

	private static final int NUM_OF_COLS = 5;
	private static final int NUM_OF_ROWS = 5;
	private static final int X_DISTANCE = 50;
	private static final int Y_DISTANCE = 50;

	private static final int MARGIN = 50;

	private static final int INNER_RECT_SIDE = 5;

	@Override
	protected Map<String, Object> getTemplateData(String csvFile) throws FileNotFoundException,
			IOException {
		Map<String, Object> data = new HashMap<String, Object>();

		SimplePlacemarkObject previousPlacemark = null;

		// Read CSV file so that we can store the information in a Map that can
		// be used by freemarker to do the "goal-replacement"
		CSVReader reader = new CSVReader(new FileReader(csvFile), ' ');
		String[] nextRow;
		List<SimplePlacemarkObject> placemarks = new ArrayList<SimplePlacemarkObject>();
		while ((nextRow = reader.readNext()) != null) {
			// nextLine[] is an array of values from the line

			try {
				
				String currentPlaceMarkId = "ge_" + nextRow[0];

				if (previousPlacemark != null) {
					// Give the current ID to the previous placemark so that we
					// can move from plcemark to placemark
					previousPlacemark.setNextPlacemarkId(currentPlaceMarkId);
				}

				double originalX = Double.parseDouble(nextRow[1]);
				double originalY = Double.parseDouble(nextRow[2]);
				
				Point transformedPoint = latLongToCartesian(originalX, originalY );

				SimplePlacemarkObject parentPlacemark = new SimplePlacemarkObject(transformedPoint.getCoordinate(),
						currentPlaceMarkId);

				previousPlacemark = parentPlacemark;
				
				List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<SimplePlacemarkObject>();
				int counter = 0;
				for (int col = 0; col < NUM_OF_COLS; col++) {
					double temX = originalX + col * X_DISTANCE;
					for (int row = 0; row < NUM_OF_ROWS; row++) {
						double temY = originalY - row * Y_DISTANCE;

						transformedPoint = latLongToCartesian(temX, temY);
						SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(transformedPoint.getCoordinate(),
								currentPlaceMarkId);
						
						// Get the inner bounbdaiures of the squares
						List<SimpleCoordinate> coords = new ArrayList<SimpleCoordinate>();
						coords.add( new SimpleCoordinate( latLongToCartesian(temX , temY).getCoordinate() ) );
						
						coords.add( new SimpleCoordinate( latLongToCartesian(temX + INNER_RECT_SIDE , temY).getCoordinate() ) );
						coords.add( new SimpleCoordinate( latLongToCartesian(temX  + INNER_RECT_SIDE , temY  + INNER_RECT_SIDE).getCoordinate() ) );
						coords.add( new SimpleCoordinate( latLongToCartesian(temX , temY  + INNER_RECT_SIDE ).getCoordinate() ) );
						
						
						coords.add( new SimpleCoordinate( latLongToCartesian(temX , temY).getCoordinate() ) );
						insidePlacemark.setShape(coords);
						
						pointsInPlacemark.add(insidePlacemark);
						
					}

				}

				parentPlacemark.setPoints(pointsInPlacemark);

				List<SimpleCoordinate> shapePoints = new ArrayList<SimpleCoordinate>();

				String south, north, west, east;

				// TOP LEFT
				double tlX = originalX - MARGIN;
				double tlY = originalY - (Y_DISTANCE * (NUM_OF_ROWS - 1)) - MARGIN;
				transformedPoint = latLongToCartesian(tlX, tlY);
				shapePoints.add(new SimpleCoordinate(transformedPoint.getCoordinate()));

				north = transformedPoint.getCoordinate().y + "";
				east = transformedPoint.getCoordinate().x + "";

				// TOP RIGHT
				tlX = originalX + (X_DISTANCE * (NUM_OF_COLS - 1)) + MARGIN;
				tlY = originalY - (Y_DISTANCE * (NUM_OF_ROWS - 1)) - MARGIN;
				transformedPoint = latLongToCartesian(tlX, tlY);
				shapePoints.add(new SimpleCoordinate(transformedPoint.getCoordinate()));

				west = transformedPoint.getCoordinate().x + "";

				// BOTTOM RIGHT
				tlX = originalX + (X_DISTANCE * (NUM_OF_COLS - 1)) + MARGIN;
				tlY = originalY + MARGIN;
				transformedPoint = latLongToCartesian(tlX, tlY);
				shapePoints.add(new SimpleCoordinate(transformedPoint.getCoordinate()));

				south = transformedPoint.getCoordinate().y + "";

				// BOTTOM LEFT
				tlX = originalX - MARGIN;
				tlY = originalY + MARGIN;
				transformedPoint = latLongToCartesian(tlX, tlY);
				shapePoints.add(new SimpleCoordinate(transformedPoint.getCoordinate()));

				// TOP LEFT -- CLOSE RECTANGLE
				tlX = originalX - MARGIN;
				tlY = originalY - (Y_DISTANCE * (NUM_OF_ROWS - 1)) - MARGIN;
				transformedPoint = latLongToCartesian(tlX, tlY);
				shapePoints.add(new SimpleCoordinate(transformedPoint.getCoordinate()));



				parentPlacemark.setShape(shapePoints);
				
				parentPlacemark.setRegion(new SimpleRegion(north, west, south, east));

				placemarks.add(parentPlacemark);

			} catch (NumberFormatException e) {
				logger.error("Error in the number formatting", e);
			} catch (Exception e) {
				logger.error("Error in the number formatting", e);
			}

		}
		reader.close();
		data.put("placemarks", placemarks);
		return data;
	}



}
