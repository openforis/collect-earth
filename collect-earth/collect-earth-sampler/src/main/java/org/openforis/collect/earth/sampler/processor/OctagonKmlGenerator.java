package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.opengis.referencing.operation.TransformException;


public class OctagonKmlGenerator extends CircleKmlGenerator{

	private static final int NUMBER_OF_EXTERNAL_POINTS = 16;
	private static final int NUMBER_OF_NON_CENTRAL_SAMPLING_POINTS = 20;


	public OctagonKmlGenerator(String epsgCode, String hostAddress, String localPort,
			Integer innerPointSide, float radius) {
		super(epsgCode, hostAddress, localPort, innerPointSide, radius);
	}
	
	
	protected int getNumberOfExternalPoints() {
		return NUMBER_OF_EXTERNAL_POINTS;
	}
	
	protected int getNumberOfNonCentralSamplingPoints() {
		return NUMBER_OF_NON_CENTRAL_SAMPLING_POINTS;
	}
	
	@Override
	public void fillSamplePoints(double distanceBetweenSamplePoints, double[] centerCoordinate, String currentPlaceMarkId,
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

		parentPlacemark.setPoints(pointsInPlacemark);
	}
	
}
