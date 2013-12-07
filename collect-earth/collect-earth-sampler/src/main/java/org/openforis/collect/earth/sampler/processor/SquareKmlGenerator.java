package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.opengis.referencing.operation.TransformException;

public class SquareKmlGenerator extends PolygonKmlGenerator {

	int numberOfPoints = 0;

	public SquareKmlGenerator(String epsgCode, String host, String port, Integer innerPointSide, int numberOfPoints) {
		super(epsgCode, host, port, innerPointSide);
		this.numberOfPoints = numberOfPoints;
	}

	protected void addMiniPlacemarks(int numberOfPlacemarks, double[] coordOriginal, SimplePlacemarkObject parentPlacemark) {

	}

	@Override
	public void fillExternalLine(float distanceBetweenSamplePoints, float distancePlotBoundary, double[] coordOriginalLatLong,
			SimplePlacemarkObject parentPlacemark) throws TransformException {
		final List<SimpleCoordinate> shapePoints = new ArrayList<SimpleCoordinate>();

		final double xSideLength = (distanceBetweenSamplePoints * (getNumOfRows() - 2)) + 2 * distancePlotBoundary;
		final double ySideLength = (distanceBetweenSamplePoints * (getNumOfRows() - 2)) + 2 * distancePlotBoundary;

		// Move to the top-left point
		final double originalCoordGeneralOffsetX = (-1d * (getNumOfRows() - 2) * distanceBetweenSamplePoints / 2d) - distancePlotBoundary;
		final double originalCoordGeneralOffsetY = ((getNumOfRows() - 2) * distanceBetweenSamplePoints / 2d) + distancePlotBoundary;

		final double[] topLeftSquareCoord = getPointWithOffset(coordOriginalLatLong, originalCoordGeneralOffsetX, originalCoordGeneralOffsetY);

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
	public void fillSamplePoints(float distanceBetweenSamplePoints, double[] centerCoordinate, String currentPlaceMarkId,
			SimplePlacemarkObject parentPlacemark) throws TransformException {

		// Move to the top-left point
		final double originalCoordGeneralOffsetX = (-1d * getNumOfRows() * distanceBetweenSamplePoints / 2d) - getPointSide() / 2d;
		final double originalCoordGeneralOffsetY = (getNumOfRows() * distanceBetweenSamplePoints / 2d) - getPointSide() / 2d;

		final double[] topLeftCoord = getPointWithOffset(centerCoordinate, originalCoordGeneralOffsetX, originalCoordGeneralOffsetY);

		final List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<SimplePlacemarkObject>();

		final boolean addCentralPoints = getPointSide() > 20;

		for (int col = 1; col < getNumOfRows(); col++) {
			final double offsetLong = col * distanceBetweenSamplePoints; // GO
			// EAST
			for (int row = 1; row < getNumOfRows(); row++) {
				final double offsetLat = -(row * distanceBetweenSamplePoints); // GO
				// SOUTH

				final double[] miniPlacemarkPosition = getPointWithOffset(topLeftCoord, offsetLong, offsetLat);
				final SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(miniPlacemarkPosition, currentPlaceMarkId);

				insidePlacemark.setShape(getSamplePointPolygon(miniPlacemarkPosition, getPointSide()));

				pointsInPlacemark.add(insidePlacemark);

				if (addCentralPoints) {

					final double[] centerPosition = getPointWithOffset(miniPlacemarkPosition, getPointSide() / 2, getPointSide() / 2);
					final SimplePlacemarkObject centralPoint = new SimplePlacemarkObject(centerPosition, currentPlaceMarkId + "center");
					centralPoint.setShape(getSamplePointPolygon(centerPosition, 1));
					pointsInPlacemark.add(centralPoint);
				}
			}

		}

		if (numberOfPoints % 2 == 1) {
			if (addCentralPoints) {
				parentPlacemark.setSamplePointOutlined(numberOfPoints - 1);
			} else {
				parentPlacemark.setSamplePointOutlined((int) Math.ceil(numberOfPoints / 2d) - 1);
			}
		}

		parentPlacemark.setPoints(pointsInPlacemark);
	}

	@Override
	protected int getNumOfRows() {
		return (int) Math.sqrt(numberOfPoints) + 1;
	}

}
