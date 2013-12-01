package org.openforis.collect.earth.sampler.processor;

import java.awt.geom.Rectangle2D;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.opengis.referencing.operation.TransformException;

public class CircleKmlGenerator extends PolygonKmlGenerator {

	private static final int NUMBER_OF_NON_CENTRAL_SAMPLING_POINTS = 24;

	private static final int RADIUS_OF_CIRCLE = 40;

	private static final int NUMBER_OF_EXTERNAL_POINTS = 70;

	private static final int MARGIN_CIRCLE = 5;

	public CircleKmlGenerator(String epsgCode, String host, String port, Integer innerPointSide) {
		super(epsgCode, host, port, innerPointSide);
	}

	private boolean checkPlacemarkOverlaps(SimplePlacemarkObject newPlacemark, List<SimplePlacemarkObject> readyPlacemarks) {
		boolean shareSpace = false;
		for (final SimplePlacemarkObject oldPlacemark : readyPlacemarks) {
			if (placemarkIntersects(newPlacemark, oldPlacemark)) {
				shareSpace = true;
			}
		}
		return shareSpace;
	}

	private Rectangle2D createRectangle(List<SimpleCoordinate> samplingSquarePoints) {

		Float minX = null, minY = null, maxX = null, maxY = null;
		for (final SimpleCoordinate simplePlacemarkObject : samplingSquarePoints) {
			final float longitude = Float.parseFloat(simplePlacemarkObject.getLongitude());
			final float latitude = Float.parseFloat(simplePlacemarkObject.getLatitude());
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

	@Override
	protected void fillExternalLine(float radiusOfSamplingCircle, float distanceToBoundary, double[] centerCircleCoord,
			SimplePlacemarkObject parentPlacemark) throws TransformException {
		final List<SimpleCoordinate> shapePoints = new ArrayList<SimpleCoordinate>();

		final float arc = 360 / NUMBER_OF_EXTERNAL_POINTS;

		final float radius = radiusOfSamplingCircle + MARGIN_CIRCLE;

		for (int i = 0; i < NUMBER_OF_EXTERNAL_POINTS; i++) {
			final double t = i * arc;
			final double offsetLong = Math.round(radius * Math.cos(Math.toRadians(t)));
			final double offsetLat = Math.round(radius * Math.sin(Math.toRadians(t)));

			final double[] circunferencePosition = getPointWithOffset(centerCircleCoord, offsetLong, offsetLat);
			shapePoints.add(new SimpleCoordinate(circunferencePosition));
		}

		// CLOSE
		final double offsetLong = Math.round(radius * Math.cos(0));
		final double offsetLat = Math.round(radius * Math.sin(0));
		final double[] circunferencePosition = getPointWithOffset(centerCircleCoord, offsetLong, offsetLat);
		shapePoints.add(new SimpleCoordinate(circunferencePosition));

		parentPlacemark.setShape(shapePoints);

		final double[] left = getPointWithOffset(centerCircleCoord, -1 * radius, 0);
		final double[] right = getPointWithOffset(centerCircleCoord, radius, 0);

		final double[] top = getPointWithOffset(centerCircleCoord, 0, radius);
		final double[] bottom = getPointWithOffset(centerCircleCoord, 0, -1 * radius);

		parentPlacemark.setRegion(new SimpleRegion(top[1] + "", left[0] + "", bottom[1] + "", right[0] + ""));
	}

	@Override
	protected void fillSamplePoints(float distanceBetweenSamplePoints, double[] coordOriginalPoints, String currentPlaceMarkId,
			SimplePlacemarkObject parentPlacemark) throws TransformException {

		final List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<SimplePlacemarkObject>();

		final List<SimpleCoordinate> samplePointBoundaries = getSamplePointPolygon(coordOriginalPoints, getPointSide());
		final SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(coordOriginalPoints, currentPlaceMarkId);
		// Get the center sampling point
		insidePlacemark.setShape(samplePointBoundaries);

		pointsInPlacemark.add(insidePlacemark);

		int numPoints = 0;
		while (numPoints < NUMBER_OF_NON_CENTRAL_SAMPLING_POINTS) {

			final SimplePlacemarkObject randomSamplingPoint = getRandomPosition(RADIUS_OF_CIRCLE, coordOriginalPoints, currentPlaceMarkId);
			if (!checkPlacemarkOverlaps(randomSamplingPoint, pointsInPlacemark)) {
				pointsInPlacemark.add(randomSamplingPoint);
				numPoints++;
			}

		}

		parentPlacemark.setPoints(pointsInPlacemark);

	}

	@Override
	int getNumOfRows() {
		return 25;
	}

	private SimplePlacemarkObject getRandomPosition(double orginalRadius, double[] centerCoordinates, String currentPlaceMarkId)
			throws TransformException {

		// http://www.anderswallin.net/2009/05/uniform-random-points-in-a-circle-using-polar-coordinates

		final double randomAngle = 2d * Math.PI * Math.random();
		final double randomRadius = orginalRadius * Math.sqrt(Math.random());

		final double offsetLong = randomRadius * Math.cos(randomAngle);
		final double offsetLat = randomRadius * Math.sin(randomAngle);

		final double[] randomCenterPosition = getPointWithOffset(centerCoordinates, offsetLong, offsetLat);
		final SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(randomCenterPosition, currentPlaceMarkId);

		final List<SimpleCoordinate> samplePointBoundaries = getSamplePointPolygon(randomCenterPosition, getPointSide());

		insidePlacemark.setShape(samplePointBoundaries);

		return insidePlacemark;
	}

	private boolean placemarkIntersects(SimplePlacemarkObject newPlacemark, SimplePlacemarkObject oldPlacemark) {
		final Rectangle2D r1 = createRectangle(newPlacemark.getShape());
		final Rectangle2D r2 = createRectangle(oldPlacemark.getShape());
		return r1.intersects(r2) ? true : false;
	}

}
