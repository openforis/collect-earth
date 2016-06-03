package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.opengis.referencing.operation.TransformException;

public class SquareKmlGenerator extends AbstractPolygonKmlGenerator {

	public SquareKmlGenerator(String epsgCode, String hostAddress, String localPort,Integer innerPointSide,  Integer numberOfPoints,  double distanceBetweenSamplePoints, double distancePlotBoundary) {
		super(epsgCode, hostAddress, localPort, innerPointSide, numberOfPoints, distanceBetweenSamplePoints, distancePlotBoundary);
	}

	protected void addMiniPlacemarks(int numberOfPlacemarks, double[] coordOriginal, SimplePlacemarkObject parentPlacemark) {

	}

	@Override
	public void fillExternalLine(SimplePlacemarkObject placemark) throws TransformException {
		final List<SimpleCoordinate> shapePoints = new ArrayList<SimpleCoordinate>();

		final double xSideLength = (distanceBetweenSamplePoints * (getNumOfRows() - 2)) + 2 * distancePlotBoundary;
		final double ySideLength = (distanceBetweenSamplePoints * (getNumOfRows() - 2)) + 2 * distancePlotBoundary;

		// Move to the top-left point
		final double originalCoordGeneralOffsetX = (-1d * (getNumOfRows() - 2) * distanceBetweenSamplePoints / 2d) - distancePlotBoundary;
		final double originalCoordGeneralOffsetY = ((getNumOfRows() - 2) * distanceBetweenSamplePoints / 2d) + distancePlotBoundary;

		final double[] topLeftSquareCoordLatLong = getPointWithOffset( placemark.getCoord().getCoordinates(), originalCoordGeneralOffsetX, originalCoordGeneralOffsetY);

		String south, north, west, east;

		// TOP LEFT
		shapePoints.add(new SimpleCoordinate(topLeftSquareCoordLatLong));

		north = topLeftSquareCoordLatLong[0] + "";
		west = topLeftSquareCoordLatLong[1] + "";

		// TOP RIGHT
		double offsetLong = xSideLength;
		double offsetLat = 0;

		double[] squareCorner = getPointWithOffset(topLeftSquareCoordLatLong, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(squareCorner));

		east = squareCorner[1] + "";

		// BOTTOM RIGHT
		offsetLong = xSideLength;
		offsetLat = -ySideLength;
		squareCorner = getPointWithOffset(topLeftSquareCoordLatLong, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(squareCorner));

		south = squareCorner[0] + "";

		// BOTTOM LEFT
		offsetLong = 0;
		offsetLat = -ySideLength;
		squareCorner = getPointWithOffset(topLeftSquareCoordLatLong, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(squareCorner));

		// TOP LEFT -- CLOSE RECTANGLE
		shapePoints.add(new SimpleCoordinate(topLeftSquareCoordLatLong));

		placemark.setShape(shapePoints);

		placemark.setRegion(new SimpleRegion(north, west, south, east));
	}

	@Override
	public void fillSamplePoints( SimplePlacemarkObject placemark) throws TransformException {

		// Move to the top-left point
		final double originalCoordGeneralOffsetX = (-1d * getNumOfRows() * distanceBetweenSamplePoints / 2d) - getPointSide() / 2d;
		final double originalCoordGeneralOffsetY = (getNumOfRows() * distanceBetweenSamplePoints / 2d) - getPointSide() / 2d;

		final double[] topLeftCoord = getPointWithOffset(placemark.getCoord().getCoordinates(), originalCoordGeneralOffsetX, originalCoordGeneralOffsetY);

		final List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<SimplePlacemarkObject>();

		final boolean addCentralPoints = getPointSide() > 20;

		if( getNumberOfSamplePoints() > 1 ){
			for (int col = 1; col < getNumOfRows(); col++) {
				final double offsetLong = col * distanceBetweenSamplePoints; // GO
				// EAST
				for (int row = 1; row < getNumOfRows(); row++) {
					final double offsetLat = -(row * distanceBetweenSamplePoints); // GO
					// SOUTH
	
					final double[] miniPlacemarkPosition = getPointWithOffset(topLeftCoord, offsetLong, offsetLat);
					final SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(miniPlacemarkPosition, placemark.getPlacemarkId() + "_" + col+"_"+row);
	
					insidePlacemark.setShape(getSamplePointPolygon(miniPlacemarkPosition, getPointSide()));
	
					pointsInPlacemark.add(insidePlacemark);
	
					if (addCentralPoints) {
	
						final double[] centerPosition = getPointWithOffset(miniPlacemarkPosition, getPointSide() / 2, getPointSide() / 2);
						final SimplePlacemarkObject centralPoint = new SimplePlacemarkObject(centerPosition, placemark.getPlacemarkId() + "center");
						centralPoint.setShape(getSamplePointPolygon(centerPosition, getPointSide()));
						pointsInPlacemark.add(centralPoint);
					}
				}
	
			}
		}else{
			final double[] centerPosition = getPointWithOffset(placemark.getCoord().getCoordinates(), -1* getPointSide() / 2, -1 * getPointSide() / 2);
			final SimplePlacemarkObject centralPoint = new SimplePlacemarkObject(centerPosition, placemark.getPlacemarkId() + "center");
			centralPoint.setShape(getSamplePointPolygon(centerPosition, getPointSide()));
			pointsInPlacemark.add(centralPoint);
		}

		if (getNumberOfSamplePoints() % 2 == 1) {
			if (addCentralPoints) {
				placemark.setSamplePointOutlined(getNumberOfSamplePoints() - 1);
			} else {
				placemark.setSamplePointOutlined((int) Math.ceil(getNumberOfSamplePoints() / 2d) - 1);
			}
		}

		placemark.setPoints(pointsInPlacemark);
	}

	protected int getNumOfRows() {
		return (int) Math.sqrt(getNumberOfSamplePoints()) + 1;
	}

}
