package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.opengis.referencing.operation.TransformException;

public class SquareKmlGenerator extends PolygonKmlGenerator {

	public SquareKmlGenerator(String epsgCode, String host, String port) {
		super(epsgCode, host, port);
	}


	@Override
	protected void fillExternalLine(float distanceBetweenSamplePoints, double[] coordOriginalPoints,
			SimplePlacemarkObject parentPlacemark) throws TransformException {
		List<SimpleCoordinate> shapePoints = new ArrayList<SimpleCoordinate>();

		// Move to the top-left point
		final double originalCoordGeneralOffsetX = (-1d * NUM_OF_COLS * distanceBetweenSamplePoints / 2d) - INNER_RECT_SIDE / 2d;
		final double originalCoordGeneralOffsetY = (NUM_OF_ROWS * distanceBetweenSamplePoints / 2d) - INNER_RECT_SIDE / 2d;

		coordOriginalPoints = getPointWithOffset(coordOriginalPoints, originalCoordGeneralOffsetX, originalCoordGeneralOffsetY);

		String south, north, west, east;

		// TOP LEFT
		shapePoints.add(new SimpleCoordinate(coordOriginalPoints));

		north = coordOriginalPoints[1] + "";
		west = coordOriginalPoints[0] + "";

		// TOP RIGHT
		double offsetLong = (distanceBetweenSamplePoints * NUM_OF_COLS);
		double offsetLat = 0;

		double[] squareCorner = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(squareCorner));

		east = squareCorner[0] + "";

		// BOTTOM RIGHT
		offsetLong = (distanceBetweenSamplePoints * NUM_OF_COLS);
		offsetLat = -(distanceBetweenSamplePoints * NUM_OF_ROWS);
		squareCorner = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(squareCorner));

		south = squareCorner[1] + "";

		// BOTTOM LEFT
		offsetLong = 0;
		offsetLat = -(distanceBetweenSamplePoints * NUM_OF_ROWS);
		squareCorner = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(squareCorner));

		// TOP LEFT -- CLOSE RECTANGLE
		shapePoints.add(new SimpleCoordinate(coordOriginalPoints));

		parentPlacemark.setShape(shapePoints);

		parentPlacemark.setRegion(new SimpleRegion(north, west, south, east));
	}


	@Override
	protected void fillSamplePoints(float distanceBetweenSamplePoints,
			double[] coordOriginalPoints, String currentPlaceMarkId, SimplePlacemarkObject parentPlacemark)
			throws TransformException {

		// Move to the top-left point
		final double originalCoordGeneralOffsetX = (-1d * NUM_OF_COLS * distanceBetweenSamplePoints / 2d) - INNER_RECT_SIDE / 2d;
		final double originalCoordGeneralOffsetY = (NUM_OF_ROWS * distanceBetweenSamplePoints / 2d) - INNER_RECT_SIDE / 2d;

		coordOriginalPoints = getPointWithOffset(coordOriginalPoints, originalCoordGeneralOffsetX, originalCoordGeneralOffsetY);

		List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<SimplePlacemarkObject>();

		for (int col = 1; col < NUM_OF_COLS; col++) {
			double offsetLong = col * distanceBetweenSamplePoints; // GO
			// EAST
			for (int row = 1; row < NUM_OF_ROWS; row++) {
				double offsetLat = -(row * distanceBetweenSamplePoints); // GO
				// SOUTH

				double[] miniPlacemarkPosition = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
				SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(miniPlacemarkPosition,
						currentPlaceMarkId);

				// Get the inner bounbdaiures of the squares
				List<SimpleCoordinate> coords = new ArrayList<SimpleCoordinate>();

				coords.add(new SimpleCoordinate(miniPlacemarkPosition)); // TOP-LEFT

				coords.add(new SimpleCoordinate(getPointWithOffset(miniPlacemarkPosition, INNER_RECT_SIDE, 0))); // TOP-RIGHT
				coords.add(new SimpleCoordinate(getPointWithOffset(miniPlacemarkPosition, INNER_RECT_SIDE,
						INNER_RECT_SIDE))); // BOTTOM-RIGHT
				coords.add(new SimpleCoordinate(getPointWithOffset(miniPlacemarkPosition, 0, INNER_RECT_SIDE))); // BOTTOM-LEFT

				// close the square
				coords.add(new SimpleCoordinate(miniPlacemarkPosition)); // TOP-LEFT

				insidePlacemark.setShape(coords);

				pointsInPlacemark.add(insidePlacemark);

			}

		}

		parentPlacemark.setPoints(pointsInPlacemark);
	}

}
