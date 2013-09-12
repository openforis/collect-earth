package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.opengis.referencing.operation.TransformException;

public class SquareKmlGenerator extends PolygonKmlGenerator {

	public SquareKmlGenerator(String epsgCode, String host, String port, Integer innerPointSide) {
		super(epsgCode, host, port, innerPointSide);
	}

	protected void addMiniPlacemarks(int numberOfPlacemarks, double[] coordOriginal, SimplePlacemarkObject parentPlacemark) {

	}

	@Override
	protected void fillExternalLine(float distanceBetweenSamplePoints, float distancePlotBoundary, double[] coordOriginal,
			SimplePlacemarkObject parentPlacemark) throws TransformException {
		List<SimpleCoordinate> shapePoints = new ArrayList<SimpleCoordinate>();

		double xSideLength = (distanceBetweenSamplePoints * (NUM_OF_COLS - 2)) + 2 * distancePlotBoundary;
		double ySideLength = (distanceBetweenSamplePoints * (NUM_OF_ROWS - 2)) + 2 * distancePlotBoundary;

		// Move to the top-left point
		final double originalCoordGeneralOffsetX = (-1d * (NUM_OF_COLS - 2) * distanceBetweenSamplePoints / 2d)
				- distancePlotBoundary;
		final double originalCoordGeneralOffsetY = ((NUM_OF_ROWS - 2) * distanceBetweenSamplePoints / 2d) + distancePlotBoundary;

		double[] topLeftSquareCoord = getPointWithOffset(coordOriginal, originalCoordGeneralOffsetX, originalCoordGeneralOffsetY);

		String south, north, west, east;

		// TOP LEFT
		shapePoints.add(new SimpleCoordinate(topLeftSquareCoord));

		north = topLeftSquareCoord[1] + "";
		west = topLeftSquareCoord[0] + "";

		// TOP RIGHT
		double offsetLong = xSideLength;
		double offsetLat = 0;

		double[] squareCorner = getPointWithOffset(topLeftSquareCoord, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(squareCorner));

		east = squareCorner[0] + "";

		// BOTTOM RIGHT
		offsetLong = xSideLength;
		offsetLat = -ySideLength;
		squareCorner = getPointWithOffset(topLeftSquareCoord, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(squareCorner));

		south = squareCorner[1] + "";

		// BOTTOM LEFT
		offsetLong = 0;
		offsetLat = -ySideLength;
		squareCorner = getPointWithOffset(topLeftSquareCoord, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(squareCorner));

		// TOP LEFT -- CLOSE RECTANGLE
		shapePoints.add(new SimpleCoordinate(topLeftSquareCoord));

		parentPlacemark.setShape(shapePoints);

		parentPlacemark.setRegion(new SimpleRegion(north, west, south, east));
	}


	@Override
	protected void fillSamplePoints(float distanceBetweenSamplePoints, double[] centerCoordinate, String currentPlaceMarkId,
			SimplePlacemarkObject parentPlacemark)
			throws TransformException {

		// Move to the top-left point
		final double originalCoordGeneralOffsetX = (-1d * NUM_OF_COLS * distanceBetweenSamplePoints / 2d) - getPointSide() / 2d;
		final double originalCoordGeneralOffsetY = (NUM_OF_ROWS * distanceBetweenSamplePoints / 2d) - getPointSide() / 2d;

		double[] topLeftCoord = getPointWithOffset(centerCoordinate, originalCoordGeneralOffsetX, originalCoordGeneralOffsetY);

		List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<SimplePlacemarkObject>();

		boolean addCentralPoints = getPointSide() > 20;

		for (int col = 1; col < NUM_OF_COLS; col++) {
			double offsetLong = col * distanceBetweenSamplePoints; // GO
			// EAST
			for (int row = 1; row < NUM_OF_ROWS; row++) {
				double offsetLat = -(row * distanceBetweenSamplePoints); // GO
				// SOUTH

				double[] miniPlacemarkPosition = getPointWithOffset(topLeftCoord, offsetLong, offsetLat);
				SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(miniPlacemarkPosition,
						currentPlaceMarkId);

				insidePlacemark.setShape(getSamplePointPolygon(miniPlacemarkPosition, getPointSide()));

				pointsInPlacemark.add(insidePlacemark);

				if (addCentralPoints) {

					double[] centerPosition = getPointWithOffset(miniPlacemarkPosition, getPointSide() / 2, getPointSide() / 2);
					SimplePlacemarkObject centralPoint = new SimplePlacemarkObject(centerPosition, currentPlaceMarkId
							+ "center");
					centralPoint.setShape(getSamplePointPolygon(centerPosition, 1));
					pointsInPlacemark.add(centralPoint);
				}
			}

		}

		int totalNumberOfPoints = (NUM_OF_COLS - 1) * (NUM_OF_ROWS - 1);
		if (totalNumberOfPoints % 2 == 1) {
			if (addCentralPoints) {
				parentPlacemark.setSamplePointOutlined(totalNumberOfPoints - 1);
			} else {
				parentPlacemark.setSamplePointOutlined((int) Math.ceil((double) totalNumberOfPoints / 2d) - 1);
			}
		}

		parentPlacemark.setPoints(pointsInPlacemark);
	}

}
