package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.opengis.referencing.operation.TransformException;

public class SquareWithCirclesKmlGenerator extends SquareKmlGenerator {
	private static final int NUMBER_OF_EXTERNAL_POINTS = 4;

	public SquareWithCirclesKmlGenerator(String epsgCode, String host, String port, Integer innerPointSide) {
		super(epsgCode, host, port, innerPointSide, 25);
	}

	@Override
	protected void fillSamplePoints(float distanceBetweenSamplePoints, double[] centerCoordinate, String currentPlaceMarkId,
			SimplePlacemarkObject parentPlacemark) throws TransformException {

		// Move to the top-left point
		final double originalCoordGeneralOffsetX = (-1d * getNumOfRows() * distanceBetweenSamplePoints / 2d);
		final double originalCoordGeneralOffsetY = (getNumOfRows() * distanceBetweenSamplePoints / 2d);

		double[] topLeftCoord = getPointWithOffset(centerCoordinate, originalCoordGeneralOffsetX, originalCoordGeneralOffsetY);

		List<SimplePlacemarkObject> pointsInPlacemark = new ArrayList<SimplePlacemarkObject>();

		// Get the inner boundaries of the squares
		List<SimpleCoordinate> coords = new ArrayList<SimpleCoordinate>();

		for (int col = 1; col < getNumOfRows(); col++) {
			double offsetLong = col * distanceBetweenSamplePoints; // GO
			// EAST
			for (int row = 1; row < getNumOfRows(); row++) {
				double offsetLat = -(row * distanceBetweenSamplePoints); // GO
				// SOUTH

				double[] centerCircle = getPointWithOffset(topLeftCoord, offsetLong, offsetLat);

				float arc = 360 / NUMBER_OF_EXTERNAL_POINTS;

				for (int i = 0; i < NUMBER_OF_EXTERNAL_POINTS; i++) {
					double t = i * arc;
					double cosLength = Math.round(getPointSide() * Math.cos(Math.toRadians(t)));
					double sinLength = Math.round(getPointSide() * Math.sin(Math.toRadians(t)));

					double[] circunferencePosition = getPointWithOffset(centerCircle, cosLength, sinLength);
					coords.add(new SimpleCoordinate(circunferencePosition));
				}

				// CLOSE
				double cosLength = Math.round(getPointSide() * Math.cos(0));
				double sinLength = Math.round(getPointSide() * Math.sin(0));
				double[] circunferencePosition = getPointWithOffset(centerCoordinate, cosLength, sinLength);
				coords.add(new SimpleCoordinate(circunferencePosition));

				SimplePlacemarkObject insidePlacemark = new SimplePlacemarkObject(centerCircle, currentPlaceMarkId);

				insidePlacemark.setShape(coords);

				pointsInPlacemark.add(insidePlacemark);


			}

		}

		parentPlacemark.setPoints(pointsInPlacemark);
	}


}
