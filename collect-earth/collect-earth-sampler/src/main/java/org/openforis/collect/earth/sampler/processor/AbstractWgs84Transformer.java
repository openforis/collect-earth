package org.openforis.collect.earth.sampler.processor;

import org.geotools.geometry.jts.JTS;
import org.geotools.referencing.CRS;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.opengis.referencing.FactoryException;
import org.opengis.referencing.crs.CoordinateReferenceSystem;
import org.opengis.referencing.operation.MathTransform;
import org.opengis.referencing.operation.TransformException;

import com.vividsolutions.jts.geom.Coordinate;
import com.vividsolutions.jts.geom.GeometryFactory;
import com.vividsolutions.jts.geom.Point;

public abstract class AbstractWgs84Transformer {

	private static final String LATLONG = "LATLONG";
	public static final String WGS84 = "WGS84";
	final String sourceEpsgCode;

	public AbstractWgs84Transformer(String sourceEpsgCode) {
		this.sourceEpsgCode = sourceEpsgCode;
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

}