package org.openforis.collect.earth.sampler.processor;

import java.util.Arrays;

import org.geotools.geometry.jts.JTS;
import org.geotools.referencing.CRS;
import org.geotools.referencing.GeodeticCalculator;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.opengis.referencing.FactoryException;
import org.opengis.referencing.crs.CoordinateReferenceSystem;
import org.opengis.referencing.operation.MathTransform;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.vividsolutions.jts.geom.Coordinate;
import com.vividsolutions.jts.geom.GeometryFactory;
import com.vividsolutions.jts.geom.Point;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public abstract class AbstractCoordinateCalculation {

	private static final String LATLONG = "LATLONG";
	public static final String WGS84 = "WGS84";
	public static final String EPSG4326 = "EPSG:4326";

	/**
	 * The initial EPSG code for the plot coordinates ( which will be changed to WGS84 - used by Google Earth )
	 */
	final String sourceEpsgCode;

	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	private final GeodeticCalculator calc = new GeodeticCalculator(DefaultGeographicCRS.WGS84);

	public AbstractCoordinateCalculation(String sourceEpsgCode) {
		this.sourceEpsgCode = sourceEpsgCode;
	}

	protected Logger getLogger() {
		return logger;
	}

	/**
	 * Returns the GWS84 coordinated as an array containing [latitude, longitude] after having translocated the point using the offset.
	 * 
	 * @param originalLatLong
	 *            The original point as a WGS84 coordinate duple.
	 * @param offsetLongitudeMeters
	 *            The amount of meters to displace the original point in the X axis. 0 does nothing, negative values move it WEST and positive values
	 *            move it EAST
	 * @param offsetLatitudeMeters
	 *            The amount of meters to displace the original point in the Y axis. 0 does nothing, negative values move it SOUTH and positive values
	 *            move it NORTH
	 * @return The coordinates of the original point after being displaced usingth eprovided offsets.
	 * @throws TransformException
	 */
	protected double[] getPointWithOffset(double[] originalLatLong, double offsetLongitudeMeters, double offsetLatitudeMeters)
			throws TransformException {
		double[] movedPointXY = null;
		try {

			if (offsetLatitudeMeters == 0 && offsetLongitudeMeters == 0) {
				movedPointXY = originalLatLong;
			} else {

				double longitudeDirection = 90; // EAST
				if (offsetLongitudeMeters < 0) {
					longitudeDirection = -90; // WEST
				}

				double latitudeDirection = 0; // NORTH
				if (offsetLatitudeMeters < 0) {
					latitudeDirection = 180; // SOUTH
				}

				calc.setStartingGeographicPoint(originalLatLong[1], originalLatLong[0]);

				boolean longitudeChanged = false;
				if (offsetLongitudeMeters != 0) {
					calc.setDirection(longitudeDirection, Math.abs(offsetLongitudeMeters));
					longitudeChanged = true;
				}

				if (offsetLatitudeMeters != 0) {
					if (longitudeChanged) {
						final double[] firstMove = calc.getDestinationPosition().getCoordinate();
						calc.setStartingGeographicPoint(firstMove[0], firstMove[1]);
					}
					calc.setDirection(latitudeDirection, Math.abs(offsetLatitudeMeters));
				}

				movedPointXY = calc.getDestinationPosition().getCoordinate();
			}
		} catch (final Exception e) {
			getLogger().error(
					"Exception when moving point " + Arrays.toString(originalLatLong) + " with offset longitude " + offsetLongitudeMeters
							+ " and latitude " + offsetLatitudeMeters, e);
		}
		if( movedPointXY!= null ){
			double[] latLongPoint = new double[]{ movedPointXY[1], movedPointXY[0]};
			return latLongPoint ;
		}else{
			return null;
		}

	}

	protected Point transformToWGS84(double longitude, double latitude) throws TransformException, FactoryException {

		final GeometryFactory gf = new GeometryFactory();
		final Coordinate c = new Coordinate(longitude, latitude);

		Point p = gf.createPoint(c);
		if (sourceEpsgCode.trim().length() > 0 && !sourceEpsgCode.equals(LATLONG) && !sourceEpsgCode.equals(WGS84)
				&& !sourceEpsgCode.equals(EPSG4326)) {
			final CoordinateReferenceSystem utmCrs = CRS.decode(sourceEpsgCode);
			final MathTransform mathTransform = CRS.findMathTransform(utmCrs, DefaultGeographicCRS.WGS84, false);
			p = (Point) JTS.transform(p, mathTransform);
		}
		return p;
	}
}