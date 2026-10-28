package org.openforis.collect.earth.app.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Google Earth Web keeps its camera in the page URL:
 * {@code https://earth.google.com/web/@LAT,LON,ALTa,DISTd,FOVy,HEADINGh,TILTt,ROLLr}. It has
 * no public API, so Collect Earth both drives it and reads its position through this URL.
 */
public final class GoogleEarthWebUrls {

	public static final String BASE = "https://earth.google.com/web";

	/** Camera distance (metres) for a plot: a whole plot plus its surroundings, top-down. */
	public static final int PLOT_DISTANCE = 400;
	/** Camera distance (metres) for the overview shown before any plot is selected. */
	public static final int OVERVIEW_DISTANCE = 5000;

	/** Camera within this many degrees (~100 m) of the plot centre counts as "at the plot". */
	private static final double TOLERANCE_DEGREES = 0.001;

	private static final Pattern CAMERA = Pattern.compile("/web/@(-?[0-9.]+),(-?[0-9.]+),");
	private static final Pattern FULL_CAMERA = Pattern.compile(
			"/web/@(-?[0-9.]+),(-?[0-9.]+),(-?[0-9.]+)a,(-?[0-9.]+)d,(-?[0-9.]+)y,(-?[0-9.]+)h,(-?[0-9.]+)t");

	/** Beyond this tilt the view is not top-down and its ground footprint is not a rectangle. */
	private static final double MAX_TOP_DOWN_TILT = 5;
	/** Vertical field of view of the camera URLs built by Collect Earth. */
	private static final String DEFAULT_FOV = "35";

	private GoogleEarthWebUrls() {
	}

	/**
	 * The height of ground (metres) a plot's camera shows from the top to the bottom of the window: the camera is
	 * {@link #PLOT_DISTANCE} above the ground, with a vertical field of view of {@link #DEFAULT_FOV}. The other sources
	 * show the plot at this scale too (ESRI Wayback).
	 */
	public static double plotViewHeightMeters() {
		return 2 * PLOT_DISTANCE * Math.tan(Math.toRadians(Double.parseDouble(DEFAULT_FOV)) / 2);
	}

	/** Top-down (no heading, no tilt) view of the given point. */
	public static String cameraUrl(String latitude, String longitude, int elevation, int distance) {
		return String.format(Locale.ENGLISH, "%s/@%s,%s,%da,%dd,35y,0h,0t,0r", BASE, latitude, longitude, elevation, distance);
	}

	/** Camera latitude/longitude from a Google Earth Web URL, or null if it is not one. */
	public static double[] cameraPosition(String url) {
		if (url == null) {
			return null;
		}
		Matcher m = CAMERA.matcher(url);
		if (!m.find()) {
			return null;
		}
		try {
			return new double[] { Double.parseDouble(m.group(1)), Double.parseDouble(m.group(2)) };
		} catch (NumberFormatException e) {
			return null;
		}
	}

	/** Whether the camera in {@code url} is centred on the given point. */
	public static boolean isCameraAt(String url, double latitude, double longitude) {
		double[] camera = cameraPosition(url);
		return camera != null && Math.abs(camera[0] - latitude) < TOLERANCE_DEGREES
				&& Math.abs(camera[1] - longitude) < TOLERANCE_DEGREES / Math.max(0.1, Math.cos(Math.toRadians(latitude)));
	}

	/**
	 * The camera moved over another point with {@code heightMeters} of ground in view, aimed at
	 * {@code altitude}. The heading and tilt the user gave Google Earth Web are kept: only where it
	 * looks and how far changes.
	 */
	public static String movedCameraUrl(String currentUrl, double latitude, double longitude, double heightMeters,
			double altitude) {
		Matcher m = currentUrl == null ? null : FULL_CAMERA.matcher(currentUrl);
		boolean camera = m != null && m.find();
		String fov = camera ? m.group(5) : DEFAULT_FOV;
		String heading = camera ? m.group(6) : "0";
		String tilt = camera ? m.group(7) : "0";
		double distance = heightMeters / (2 * Math.tan(Math.toRadians(Double.parseDouble(fov)) / 2));
		return String.format(Locale.ENGLISH, "%s/@%s,%s,%sa,%sd,%sy,%sh,%st,0r", BASE, number(latitude, 7),
				number(longitude, 7), number(altitude, 0), number(Math.max(1, distance), 1), fov, heading, tilt);
	}

	/** The altitude (metres) of the point the camera aims at, or null if it is not a camera URL. */
	public static Double cameraAltitude(String url) {
		Matcher m = url == null ? null : FULL_CAMERA.matcher(url);
		if (m == null || !m.find()) {
			return null;
		}
		try {
			return Double.parseDouble(m.group(3));
		} catch (NumberFormatException e) {
			return null;
		}
	}

	/** The distance (metres) of the camera from the point it aims at, or null if it is not a camera URL. */
	public static Double cameraDistance(String url) {
		Matcher m = url == null ? null : FULL_CAMERA.matcher(url);
		if (m == null || !m.find()) {
			return null;
		}
		try {
			return Double.parseDouble(m.group(4));
		} catch (NumberFormatException e) {
			return null;
		}
	}

	/**
	 * The ground area shown by a top-down Google Earth Web view: centre, size in metres
	 * (from the camera distance, the vertical field of view and the window aspect ratio) and
	 * heading in degrees clockwise from north. Null for other URLs or tilted views.
	 */
	public static Map<String, Object> cameraView(String url, double windowWidth, double windowHeight) {
		return cameraView(url, windowWidth, windowHeight, null);
	}

	/**
	 * As {@link #cameraView(String, double, double)}, for ground at {@code groundAltitude} metres (null if
	 * unknown). A camera aimed below the ground ( 0a over hills, as in the URLs built from the plot
	 * elevation ) is that much nearer to the ground than its distance says.
	 */
	public static Map<String, Object> cameraView(String url, double windowWidth, double windowHeight, Double groundAltitude) {
		Matcher m = url == null ? null : FULL_CAMERA.matcher(url);
		if (m == null || !m.find() || windowWidth <= 0 || windowHeight <= 0) {
			return null;
		}
		try {
			double distance = Double.parseDouble(m.group(4));
			double fov = Double.parseDouble(m.group(5));
			double tilt = Double.parseDouble(m.group(7));
			if (Math.abs(tilt) > MAX_TOP_DOWN_TILT) {
				return null;
			}
			if (groundAltitude != null) {
				distance = Math.max(1, distance - Math.max(0, groundAltitude - Double.parseDouble(m.group(3))));
			}
			double height = 2 * distance * Math.tan(Math.toRadians(fov) / 2);
			Map<String, Object> view = new LinkedHashMap<>();
			view.put("latitude", Double.parseDouble(m.group(1)));
			view.put("longitude", Double.parseDouble(m.group(2)));
			view.put("widthMeters", height * windowWidth / windowHeight);
			view.put("heightMeters", height);
			view.put("heading", Double.parseDouble(m.group(6)));
			return view;
		} catch (NumberFormatException e) {
			return null;
		}
	}

	public static boolean isGoogleEarthWeb(String url) {
		return url != null && url.startsWith(BASE);
	}

	/** At most {@code decimals} decimals, without trailing zeros. */
	private static String number(double value, int decimals) {
		return BigDecimal.valueOf(value).setScale(decimals, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
	}
}
