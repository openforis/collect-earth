package org.openforis.collect.earth.sampler.utils;

import java.util.List;

import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.SpatialReferenceSystem;

/**
 * Collect Earth works only with plots in WGS84 latitude and longitude, in decimal degrees (EPSG:4326), the system of
 * Google Earth Web and of the imagery it opens. There is no conversion from other coordinate systems: a survey that
 * uses another one is refused with a message that says so (see {@link NotWgs84Exception}). GeoTools' EPSG database,
 * which the conversion needed, was left out of the build in November 2020, so the conversion only ever failed since.
 */
public class GeoUtils {

	public static final String LATLONG = "LATLONG";
	public static final String WGS84 = "WGS84";
	public static final String EPSG4326 = "EPSG:4326";

	private GeoUtils() {}

	/**
	 * Whether the id of a spatial reference system is WGS84 latitude and longitude: empty (or none), "LATLONG", "WGS84"
	 * or "EPSG:4326", whatever their case and the spaces around them.
	 */
	public static boolean isUsingWGS84(String srsId) {
		if (srsId == null) {
			return true;
		}
		final String id = srsId.trim();
		return id.isEmpty() || id.equalsIgnoreCase(LATLONG) || id.equalsIgnoreCase(WGS84) || id.equalsIgnoreCase(EPSG4326);
	}

	/**
	 * The id of the coordinate system of the survey's plots: its first spatial reference system, as a Collect Earth
	 * survey has only one. "" when there is no survey or it has none, which is taken as WGS84.
	 */
	public static String getSurveySrsId(CollectSurvey survey) {
		if (survey == null) {
			return "";
		}
		final List<SpatialReferenceSystem> systems = survey.getSpatialReferenceSystems();
		if (systems == null || systems.isEmpty() || systems.get(0) == null || systems.get(0).getId() == null) {
			return "";
		}
		return systems.get(0).getId().trim();
	}

	/** Whether the survey's plots are in WGS84 latitude and longitude ({@link #isUsingWGS84(String)} of its system). */
	public static boolean isUsingWGS84(CollectSurvey survey) {
		return isUsingWGS84(getSurveySrsId(survey));
	}

	/**
	 * Whether the coordinates can be WGS84 decimal degrees: the latitude between -90 and 90 and the longitude between
	 * -180 and 180. A plot outside is in another system (UTM metres, for instance), or its columns are swapped.
	 */
	public static boolean isInWgs84Range(double latitude, double longitude) {
		return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
	}
}
