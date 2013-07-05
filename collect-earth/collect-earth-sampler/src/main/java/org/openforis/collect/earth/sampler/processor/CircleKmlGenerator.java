package org.openforis.collect.earth.sampler.processor;

import java.awt.geom.Rectangle2D;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.opengis.referencing.operation.TransformException;

public class CircleKmlGenerator extends PolygonKmlGenerator {

	private static final int NUMBER_OF_EXTERNAL_POINTS = 70;

	private static final int MARGIN_CIRCLE = 5;

	private static final int NUMBER_OF_POINTS_RADIUS = 2;

	public CircleKmlGenerator(String epsgCode, String host, String port) {
		super(epsgCode, host, port);
	}

	@Override
	protected void fillExternalLine(float distanceBetweenSamplePoints, double[] coordOriginalPoints,
			SimplePlacemarkObject parentPlacemark) throws TransformException {
		List<SimpleCoordinate> shapePoints = new ArrayList<SimpleCoordinate>();

		float arc = 360 / NUMBER_OF_EXTERNAL_POINTS;

		for (int i = 0; i < NUMBER_OF_EXTERNAL_POINTS; i++) {
			double t = i * arc;
			double offsetLong = Math.round(((distanceBetweenSamplePoints * NUMBER_OF_POINTS_RADIUS) + MARGIN_CIRCLE)
					* Math.cos(Math.toRadians(t)));
			double offsetLat = Math.round(((distanceBetweenSamplePoints * NUMBER_OF_POINTS_RADIUS) + MARGIN_CIRCLE)
					* Math.sin(Math.toRadians(t)));

			double[] circunferencePosition = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
			shapePoints.add(new SimpleCoordinate(circunferencePosition));
		}
		
		// CLOSE
		double offsetLong = Math.round(((distanceBetweenSamplePoints * NUMBER_OF_POINTS_RADIUS) + MARGIN_CIRCLE)* Math.cos(0));
		double offsetLat = Math.round(((distanceBetweenSamplePoints * NUMBER_OF_POINTS_RADIUS) + MARGIN_CIRCLE) * Math.sin(0));
		double[] circunferencePosition = getPointWithOffset(coordOriginalPoints, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(circunferencePosition));

		parentPlacemark.setShape(shapePoints);
	}


	@Override
	protected void fillSamplePoints(float distanceBetweenSamplePoints,
			double[] coordOriginalPoints, String currentPlaceMarkId, SimplePlacemarkObject parentPlacemark)
			throws TransformException {

		List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<SimplePlacemarkObject>();

		List<SimpleCoordinate> samplePointBoundaries = getSamplePointPolygon(coordOriginalPoints);
		SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(coordOriginalPoints, currentPlaceMarkId);
		// Get the center sampling point
		insidePlacemark.setShape(samplePointBoundaries);

		pointsInPlacemark.add(insidePlacemark);

		int numPoints = 0;
		while (numPoints < 24) {

			SimplePlacemarkObject randomSamplingPoint = getRandomPosition(40, coordOriginalPoints, currentPlaceMarkId);
			if (!checkPlacemarkOverlaps(randomSamplingPoint, pointsInPlacemark)) {
				pointsInPlacemark.add(randomSamplingPoint);
				numPoints++;
			}

		}

		parentPlacemark.setPoints(pointsInPlacemark);

	}


	private boolean checkPlacemarkOverlaps(SimplePlacemarkObject newPlacemark, List<SimplePlacemarkObject> readyPlacemarks) {
		boolean shareSpace = false;
		for (SimplePlacemarkObject oldPlacemark : readyPlacemarks) {
			if (placemarkIntersects(newPlacemark, oldPlacemark)) {
				shareSpace = true;
			}
		}
		return shareSpace;
	}

	private boolean placemarkIntersects(SimplePlacemarkObject newPlacemark, SimplePlacemarkObject oldPlacemark) {
		Rectangle2D r1 = createRectangle(newPlacemark.getShape());
		Rectangle2D r2 = createRectangle(oldPlacemark.getShape());
		return r1.intersects(r2) ? true : false;
	}

	private Rectangle2D createRectangle(List<SimpleCoordinate> samplingSquarePoints) {
		
		Float minX = null, minY = null, maxX = null, maxY = null;
		for (SimpleCoordinate simplePlacemarkObject : samplingSquarePoints) {
			float longitude = Float.parseFloat(simplePlacemarkObject.getLongitude());
			float latitude = Float.parseFloat(simplePlacemarkObject.getLatitude());
			if (minX == null || longitude < minX) {
				minX = longitude;
			}
			if (maxX == null || longitude > maxX) {
				maxX = longitude;
			}
			if (minY == null || latitude < minY) {
				minY = latitude;
			}
			if (maxY == null || latitude > maxY) {
				maxY = latitude;
			}
		}
		
		return new Rectangle2D.Float(minX, minY, maxX - minX, maxY - minY);
		
	}

	private SimplePlacemarkObject getRandomPosition(double orginalRadius, double[] centerCoordinates, String currentPlaceMarkId)
			throws TransformException {

		// http://www.anderswallin.net/2009/05/uniform-random-points-in-a-circle-using-polar-coordinates

		double randomAngle = 2d * Math.PI * Math.random();
		double randomRadius = orginalRadius * Math.sqrt(Math.random());

		double offsetLong = randomRadius * Math.cos(randomAngle);
		double offsetLat = randomRadius * Math.sin(randomAngle);

		double[] miniPlacemarkPosition = getPointWithOffset(centerCoordinates, offsetLong, offsetLat);
		SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(miniPlacemarkPosition, currentPlaceMarkId);

		List<SimpleCoordinate> samplePointBoundaries = getSamplePointPolygon(miniPlacemarkPosition);

		insidePlacemark.setShape(samplePointBoundaries);

		return insidePlacemark;
	}

}
