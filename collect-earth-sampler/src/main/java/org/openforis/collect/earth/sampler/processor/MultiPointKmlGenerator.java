package org.openforis.collect.earth.sampler.processor;

import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;

public class MultiPointKmlGenerator extends KmlGenerator {

	private static final int INNER_RECT_SIDE = 3;
	private static final int NUM_OF_COLS = 5;
	private static final int NUM_OF_ROWS = 5;
	private static final int X_DISTANCE = 20;
	private static final int Y_DISTANCE = 20;
	private String host;
	private String port;

	public MultiPointKmlGenerator(String epsgCode) {
		super(epsgCode);
	}

	// private static final int MARGIN = 20;

	public MultiPointKmlGenerator(String epsgCode, String host, String port) {
		super(epsgCode);
		this.host = host;
		this.port = port;
	}

	@Override
	protected Map<String, Object> getTemplateData(String csvFile) throws FileNotFoundException, IOException {
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

				Point transformedPoint = transformToWGS84(originalX, originalY); // TOP-LEFT
																					// position
				double[] coordOriginalPoints = new double[] { transformedPoint.getX(), transformedPoint.getY() };

				SimplePlacemarkObject parentPlacemark = new SimplePlacemarkObject(transformedPoint.getCoordinate(),
						currentPlaceMarkId);

				previousPlacemark = parentPlacemark;

				List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<SimplePlacemarkObject>();

				for (int col = 1; col < NUM_OF_COLS; col++) {
					double offsetLong = col * X_DISTANCE; // GO EAST
					for (int row = 1; row < NUM_OF_ROWS; row++) {
						double offsetLat = -(row * Y_DISTANCE); // GO SOUTH

						double[] miniPlacemarkPosition = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
						SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(miniPlacemarkPosition,
								currentPlaceMarkId);

						// Get the inner bounbdaiures of the squares
						List<SimpleCoordinate> coords = new ArrayList<SimpleCoordinate>();

						coords.add(new SimpleCoordinate(miniPlacemarkPosition)); // TOP-LEFT

						coords.add(new SimpleCoordinate(getPointWithOffset(miniPlacemarkPosition, INNER_RECT_SIDE, 0))); // TOP-RIGHT
						coords.add(new SimpleCoordinate(getPointWithOffset(miniPlacemarkPosition, INNER_RECT_SIDE, // BOTTOM-RIGHT
								INNER_RECT_SIDE)));
						coords.add(new SimpleCoordinate(getPointWithOffset(miniPlacemarkPosition, 0, INNER_RECT_SIDE))); // BOTTOM-LEFT

						// close the square
						coords.add(new SimpleCoordinate(miniPlacemarkPosition)); // TOP-LEFT

						insidePlacemark.setShape(coords);

						pointsInPlacemark.add(insidePlacemark);

					}

				}

				parentPlacemark.setPoints(pointsInPlacemark);

				List<SimpleCoordinate> shapePoints = new ArrayList<SimpleCoordinate>();

				String south, north, west, east;

				// TOP LEFT
				shapePoints.add(new SimpleCoordinate(coordOriginalPoints));

				north = coordOriginalPoints[1] + "";
				west = coordOriginalPoints[0] + "";

				// TOP RIGHT
				double offsetLong = (X_DISTANCE * NUM_OF_COLS);
				double offsetLat = 0;

				double[] squareCorner = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
				shapePoints.add(new SimpleCoordinate(squareCorner));

				east = squareCorner[0] + "";

				// BOTTOM RIGHT
				offsetLong = (X_DISTANCE * NUM_OF_COLS);
				offsetLat = -(Y_DISTANCE * NUM_OF_ROWS);
				squareCorner = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
				shapePoints.add(new SimpleCoordinate(squareCorner));

				south = squareCorner[1] + "";

				// BOTTOM LEFT
				offsetLong = 0;
				offsetLat = -(Y_DISTANCE * NUM_OF_ROWS);
				squareCorner = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
				shapePoints.add(new SimpleCoordinate(squareCorner));

				// TOP LEFT -- CLOSE RECTANGLE
				shapePoints.add(new SimpleCoordinate(coordOriginalPoints));

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

		String hostAndPort = "";
		if (host != null && host.length() > 0) {
			hostAndPort = host;
			if (port != null && port.length() > 0) {
				hostAndPort += ":" + port;
			}

			hostAndPort = "http://" + hostAndPort + "/earth/";
		}
		data.put("host", hostAndPort);
		return data;
	}

}
