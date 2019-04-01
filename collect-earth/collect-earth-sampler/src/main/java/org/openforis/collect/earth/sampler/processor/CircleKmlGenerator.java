package org.openforis.collect.earth.sampler.processor;

import java.awt.geom.Rectangle2D;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.opengis.referencing.operation.TransformException;

public class CircleKmlGenerator extends AbstractPolygonKmlGenerator {

	private static final int NUMBER_OF_POINTS_TO_DRAW_CIRCLE = 100;

	private double radiusOfCircle;

	private static final int MARGIN_CIRCLE = 5;
	
	public CircleKmlGenerator(String epsgCode, String hostAddress, String localPort,  Integer numberOfPoints, Integer innerPointSide, double radius ) {
		super(epsgCode, hostAddress, localPort, numberOfPoints, innerPointSide, 0, 0, (Integer)null, null);
		setRadiusOfCircle(radius);
	}

	private boolean checkPlacemarkOverlaps(SimplePlacemarkObject newPlacemark, List<SimplePlacemarkObject> readyPlacemarks) {
		boolean shareSpace = false;
		for (final SimplePlacemarkObject oldPlacemark : readyPlacemarks) {
			if (isSamplePointIntersectingWithOthers(newPlacemark, oldPlacemark)) {
				shareSpace = true;
				break;
			}
		}
		return shareSpace;
	}

	private Rectangle2D createRectangle(List<SimpleCoordinate> samplingSquarePoints) {

		float buffer = 0.000005f;
		
		Float minX = null, minY = null, maxX = null, maxY = null;
		for (final SimpleCoordinate simplePlacemarkObject : samplingSquarePoints) {
			final float longitude = Float.parseFloat(simplePlacemarkObject.getLongitude());
			final float latitude = Float.parseFloat(simplePlacemarkObject.getLatitude());
			if (minX == null || longitude < minX) {
				minX = longitude - buffer;
			}
			if (maxX == null || longitude > maxX) {
				maxX = longitude + buffer;
			}
			if (minY == null || latitude < minY) {
				minY = latitude  - buffer;
			}
			if (maxY == null || latitude > maxY) {
				maxY = latitude + buffer;
			}
		}

		// Return the rectangle described by the top-left position, width and height
		// units are degrees
		return new Rectangle2D.Float(minX, minY, maxX - minX, maxY - minY);

	}

	@Override
	public void fillExternalLine(SimplePlacemarkObject placemark) throws TransformException {
		final List<SimpleCoordinate> shapePoints = new ArrayList<>();
		
		double[] centerCircleCoord = placemark.getCoord().getCoordinates();

		final double arc = (double) 360 / getNumberOfExternalPoints();

		final double radius = radiusOfCircle + getMarginCircle();

		for (int i = 0; i < getNumberOfExternalPoints(); i++) {
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

		placemark.setShape(shapePoints);

		final double[] left = getPointWithOffset(centerCircleCoord, -1 * radius, 0);
		final double[] right = getPointWithOffset(centerCircleCoord, radius, 0);

		final double[] top = getPointWithOffset(centerCircleCoord, 0, radius);
		final double[] bottom = getPointWithOffset(centerCircleCoord, 0, -1 * radius);

		placemark.setRegion(new SimpleRegion( Double.toString( top[1] ), Double.toString(left[0] ), Double.toString(bottom[1] ), Double.toString(right[0] )));
	}

	@Override
	public void fillSamplePoints(SimplePlacemarkObject placemark) throws TransformException {

		final List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<>();

		double[] centerCircleCoord = placemark.getCoord().getCoordinates();
		
		final double[] centerPosition = getPointWithOffset(centerCircleCoord, -getPointSide() / 2d, -getPointSide() / 2d);
		final SimplePlacemarkObject centralPoint = new SimplePlacemarkObject(centerPosition, placemark.getPlacemarkId() + "center");
		centralPoint.setShape(getSamplePointPolygon(centerPosition, getPointSide() ));
		pointsInPlacemark.add(centralPoint);
		placemark.setSamplePointOutlined(0);


		int numPoints = 0;
		while (numPoints < getNumberOfSamplePoints() ) {	
			final SimplePlacemarkObject randomSamplingPoint = getRandomSamplePoint( getRadiusOfCircle(), centerCircleCoord, placemark.getPlacemarkId()+"_random_" + numPoints);
			if (!checkPlacemarkOverlaps(randomSamplingPoint, pointsInPlacemark)) {
				pointsInPlacemark.add(randomSamplingPoint);
				numPoints++;
			}
		}
		
		placemark.setPoints(pointsInPlacemark);

	}


	private SimplePlacemarkObject getRandomSamplePoint(double orginalRadius, double[] centerCoordinates, String currentPlaceMarkId)
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

	private boolean isSamplePointIntersectingWithOthers(SimplePlacemarkObject newPlacemark, SimplePlacemarkObject oldPlacemark) {
		final Rectangle2D r1 = createRectangle(newPlacemark.getShape());
		final Rectangle2D r2 = createRectangle(oldPlacemark.getShape());
		return r2.intersects(r1);
	}

	protected int getNumberOfExternalPoints() {
		return NUMBER_OF_POINTS_TO_DRAW_CIRCLE;
	}

	private static int getMarginCircle() {
		return MARGIN_CIRCLE;
	}

	protected double getRadiusOfCircle() {
		return radiusOfCircle;
	}

	private void setRadiusOfCircle(double radiusOfCircle) {
		this.radiusOfCircle = radiusOfCircle;
	}

}
