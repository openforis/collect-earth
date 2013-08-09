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

public abstract class AbstractWgs84Transformer {

	private static final String LATLONG = "LATLONG";
	public static final String WGS84 = "WGS84";
	final String sourceEpsgCode;

	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	public AbstractWgs84Transformer(String sourceEpsgCode) {
		this.sourceEpsgCode = sourceEpsgCode;
	}

	private final GeodeticCalculator calc = new GeodeticCalculator(DefaultGeographicCRS.WGS84);

	protected Logger getLogger() {
		return logger;
	}

	protected Point transformToWGS84(double longitude, double latitude) throws TransformException, FactoryException {
	
		GeometryFactory gf = new GeometryFactory();
		Coordinate c = new Coordinate(longitude, latitude);
	
		Point p = gf.createPoint(c);
		if (sourceEpsgCode.trim().length() > 0 && !sourceEpsgCode.equals(LATLONG) && !sourceEpsgCode.equals(WGS84)) {
			CoordinateReferenceSystem utmCrs = CRS.decode(sourceEpsgCode);
			MathTransform mathTransform = CRS.findMathTransform(utmCrs, DefaultGeographicCRS.WGS84, false);
			p = (Point) JTS.transform(p, mathTransform);
		}
		return p;
	}

	/**
	 * Returns the GWS84 coordinated as an array containing [longitude,latitude] after having traslocated the point using the offset.
	 * @param originalPoint The original point as a WGS84 coordinate duple.
	 * @param offsetLongitudeMeters The amount of meters to displace the original point in the X axis. 0 does nothing, negative values move it WEST and positive values move it EAST
	 * @param offsetLatitudeMeters The amount of meters to displace the original point in the Y axis. 0 does nothing, negative values move it SOUTH and positive values move it NORTH
	 * @return The coordinates of the original point after being displaced usingth eprovided offsets.
	 * @throws TransformException
	 */
	protected double[] getPointWithOffset(double[] originalPoint, double offsetLongitudeMeters, double offsetLatitudeMeters)
			throws TransformException {
		double[] movedPoint = null;
		try {

			if (offsetLatitudeMeters == 0 && offsetLongitudeMeters == 0) {
				movedPoint = originalPoint;
			} else {

				double longitudeDirection = 90; // EAST
				if (offsetLongitudeMeters < 0) {
					longitudeDirection = -90; // WEST
				}

				double latitudeDirection = 0; // NORTH
				if (offsetLatitudeMeters < 0) {
					latitudeDirection = 180; // SOUTH
				}

				calc.setStartingGeographicPoint(originalPoint[0], originalPoint[1]);

				boolean longitudeChanged = false;
				if (offsetLongitudeMeters != 0) {
					calc.setDirection(longitudeDirection, Math.abs(offsetLongitudeMeters));
					longitudeChanged = true;
				}

				if (offsetLatitudeMeters != 0) {
					if (longitudeChanged) {
						double[] firstMove = calc.getDestinationPosition().getCoordinate();
						calc.setStartingGeographicPoint(firstMove[0], firstMove[1]);
					}
					calc.setDirection(latitudeDirection, Math.abs(offsetLatitudeMeters));
				}

				movedPoint = calc.getDestinationPosition().getCoordinate();
			}
		} catch (Exception e) {
			getLogger().error(
					"Exception when moving point " + Arrays.toString(originalPoint) + " with offset longitude "
							+ offsetLongitudeMeters + " and latitude " + offsetLatitudeMeters, e);
		}
		return movedPoint;

	}
}