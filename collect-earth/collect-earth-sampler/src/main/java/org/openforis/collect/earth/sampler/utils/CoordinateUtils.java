package org.openforis.collect.earth.sampler.utils;

import org.geotools.referencing.GeodeticCalculator;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.locationtech.jts.geom.Coordinate;
import org.opengis.referencing.operation.TransformException;

public class CoordinateUtils {

	private static GeodeticCalculator calc = new GeodeticCalculator(DefaultGeographicCRS.WGS84);

	/**
	 * Returns the GWS84 coordinated as an array containing [latitude, longitude] after having translocated the point using the offset.
	 *
	 * @param originalLatLong
	 *            The original point as a WGS84 coordinate.
	 * @param offsetLongitudeMeters
	 *            The amount of meters to displace the original point in the X axis. 0 does nothing, negative values move it WEST and positive values
	 *            move it EAST
	 * @param offsetLatitudeMeters
	 *            The amount of meters to displace the original point in the Y axis. 0 does nothing, negative values move it SOUTH and positive values
	 *            move it NORTH
	 * @return The coordinates of the original point after being displaced usingth eprovided offsets.
	 * @throws TransformException
	 */
	public static Coordinate getPointWithOffset(Coordinate originalLatLong, double offsetLongitudeMeters, double offsetLatitudeMeters)
			throws TransformException {

		double[] transformed = getPointWithOffset( new double[]{ originalLatLong.y, originalLatLong.x }, offsetLongitudeMeters, offsetLatitudeMeters);
		
		return new Coordinate(transformed[0], transformed[1]);
	}

	/**
	 * Returns the GWS84 coordinated as an array containing [latitude, longitude] after having translocated the point using the offset.
	 *
	 * @param originalLatLong
	 *            The original point as a WGS84 coordinate duple. latitude, longitude
	 * @param offsetLongitudeMeters
	 *            The amount of meters to displace the original point in the X axis. 0 does nothing, negative values move it WEST and positive values
	 *            move it EAST
	 * @param offsetLatitudeMeters
	 *            The amount of meters to displace the original point in the Y axis. 0 does nothing, negative values move it SOUTH and positive values
	 *            move it NORTH
	 * @return The coordinates of the original point after being displaced using theprovided offsets as longitude, latitude.
	 * @throws TransformException
	 */
	public static synchronized double[] getPointWithOffset(double[] originalLatLong, double offsetLongitudeMeters, double offsetLatitudeMeters)
			throws TransformException {
		
		if (offsetLatitudeMeters == 0 && offsetLongitudeMeters == 0) {
			return originalLatLong;
		} else {

			double longitudeDirection = 90; // EAST
			if (offsetLongitudeMeters < 0) {
				longitudeDirection = -90; // WEST
			}

			double latitudeDirection = 0; // NORTH
			if (offsetLatitudeMeters < 0) {
				latitudeDirection = 180; // SOUTH
			}

			calc.setStartingGeographicPoint( originalLatLong[1], originalLatLong[0]);

			boolean longitudeChanged = false;
			if (offsetLongitudeMeters != 0) {
				calc.setDirection(longitudeDirection, Math.abs( offsetLongitudeMeters ) );
				longitudeChanged = true;
			}

			if (offsetLatitudeMeters != 0) {
				if (longitudeChanged) {
					// Move the point in the horizontal axis first, afterwards reset the point and move vertically
					final double[] firstMove = calc.getDestinationPosition().getCoordinate();
					calc.setStartingGeographicPoint(firstMove[0], firstMove[1]);
				}
				calc.setDirection(latitudeDirection, Math.abs( offsetLatitudeMeters ) );
			}

			double[] movedPointLatLong = calc.getDestinationPosition().getCoordinate();
			return new double[]{ movedPointLatLong[1], movedPointLatLong[0]};

		}

	}
}
