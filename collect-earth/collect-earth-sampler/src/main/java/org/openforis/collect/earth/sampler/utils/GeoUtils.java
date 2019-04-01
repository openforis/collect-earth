package org.openforis.collect.earth.sampler.utils;

import org.geotools.geometry.jts.JTS;
import org.geotools.referencing.CRS;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.opengis.referencing.FactoryException;
import org.opengis.referencing.crs.CoordinateReferenceSystem;
import org.opengis.referencing.operation.MathTransform;
import org.opengis.referencing.operation.TransformException;


public class GeoUtils {

	public static final String LATLONG = "LATLONG";
	public static final String WGS84 = "WGS84";
	public static final String EPSG4326 = "EPSG:4326";

	private GeoUtils() {}
	
	/** Check the spatial reference system used in the specified coordinates of the plots
	 * @return True if using latlong coordinates false otherwise
	 */
	public static boolean isUsingWGS84( String epsgCode ){
		return (epsgCode.trim().length() == 0 || epsgCode.equals(LATLONG) || epsgCode.equals(WGS84)  || epsgCode.equals(EPSG4326) );	
	
	}

	public static Point transformToWGS84(double longitude, double latitude, String sourceEpsgCode ) throws TransformException, FactoryException {
		final GeometryFactory gf = new GeometryFactory();
		final Coordinate c = new Coordinate(longitude, latitude);
		Point p = gf.createPoint(c);
		final CoordinateReferenceSystem sourceEpsgCRS = CRS.decode(sourceEpsgCode);
		final MathTransform mathTransform = CRS.findMathTransform(sourceEpsgCRS, DefaultGeographicCRS.WGS84, false);
		return (Point) JTS.transform(p, mathTransform);		
	}
}
