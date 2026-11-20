package org.openforis.collect.earth.sampler.utils;

/**
 * A plot that is not in WGS84 latitude and longitude in decimal degrees (EPSG:4326), the only coordinates Collect Earth
 * takes (see {@link GeoUtils}): either the survey says its plots are in another coordinate system
 * ({@link #getSurveySrsId()} is set), or the plot's coordinates are out of the range of degrees
 * ({@link #getPlotId()} is set). The message is for the log; the callers say it to the user in their language.
 */
public class NotWgs84Exception extends KmlGenerationException {

	private static final long serialVersionUID = 1L;

	private final String surveySrsId;
	private final String plotId;

	private NotWgs84Exception(String message, String surveySrsId, String plotId) {
		super(message);
		this.surveySrsId = surveySrsId;
		this.plotId = plotId;
	}

	/** The survey's plots are in the coordinate system given, which is not WGS84 */
	public static NotWgs84Exception ofSurvey(String surveySrsId) {
		return new NotWgs84Exception("The survey uses the coordinate system " + surveySrsId
				+ ": Collect Earth takes only WGS84 latitude and longitude in decimal degrees (EPSG:4326)", surveySrsId, null);
	}

	/** The plot's coordinates cannot be WGS84 degrees */
	public static NotWgs84Exception outOfRange(String plotId, double latitude, double longitude) {
		return new NotWgs84Exception("The plot " + plotId + " has the latitude " + latitude + " and the longitude " + longitude
				+ ", which are not WGS84 decimal degrees (EPSG:4326): the latitude must be between -90 and 90 and the longitude between -180 and 180",
				null, plotId);
	}

	/** The survey's coordinate system, when that is the reason; null otherwise */
	public String getSurveySrsId() {
		return surveySrsId;
	}

	/** The plot whose coordinates are out of range, when that is the reason; null otherwise */
	public String getPlotId() {
		return plotId;
	}

	/** Whether the reason is the survey's coordinate system rather than one plot */
	public boolean isAboutTheSurvey() {
		return surveySrsId != null;
	}
}
