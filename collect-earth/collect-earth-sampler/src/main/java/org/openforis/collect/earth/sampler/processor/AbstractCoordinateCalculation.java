package org.openforis.collect.earth.sampler.processor;

import org.openforis.collect.earth.sampler.utils.CoordinateUtils;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public abstract class AbstractCoordinateCalculation {

	/**
	 * The initial EPSG code for the plot coordinates ( which will be changed to WGS84 - used by Google Earth )
	 */
	final String sourceEpsgCode;

	private final Logger logger = LoggerFactory.getLogger(this.getClass());

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
		return CoordinateUtils.getPointWithOffset(originalLatLong, offsetLongitudeMeters, offsetLatitudeMeters);

	}
	

}