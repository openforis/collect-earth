package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;

public class GoogleEarthWebUrlsTest {

	@Test
	public void buildsATopDownCameraUrl() {
		assertEquals("https://earth.google.com/web/@-1.95,30.06,1500a,400d,35y,0h,0t,0r",
				GoogleEarthWebUrls.cameraUrl("-1.95", "30.06", 1500, GoogleEarthWebUrls.PLOT_DISTANCE));
	}

	@Test
	public void readsTheCameraFromUrlsGoogleEarthWebRewrites() {
		assertArrayEquals(new double[] { -1.9500123, 30.0600456 },
				GoogleEarthWebUrls.cameraPosition(
						"https://earth.google.com/web/@-1.9500123,30.0600456,1503.2a,399.98d,35y,0h,0t,0r/data=CgRCAggB"),
				1e-9);
		assertNull(GoogleEarthWebUrls.cameraPosition("https://earth.google.com/web/"));
		assertNull(GoogleEarthWebUrls.cameraPosition(null));
	}

	@Test
	public void cameraAtPlotWithinAboutAHundredMetres() {
		String url = "https://earth.google.com/web/@-1.95005,30.06004,1500a,400d,35y,0h,0t,0r";
		assertTrue(GoogleEarthWebUrls.isCameraAt(url, -1.95, 30.06));
		assertFalse(GoogleEarthWebUrls.isCameraAt(url, -1.96, 30.06));
		assertFalse(GoogleEarthWebUrls.isCameraAt("https://earth.google.com/web/", -1.95, 30.06));
	}

	@Test
	public void recognisesGoogleEarthWebPages() {
		assertTrue(GoogleEarthWebUrls.isGoogleEarthWeb("https://earth.google.com/web/@1,2,3a,4d,35y,0h,0t,0r"));
		assertFalse(GoogleEarthWebUrls.isGoogleEarthWeb("https://accounts.google.com/signin"));
	}

	@Test
	public void computesTheGroundAreaOfATopDownView() {
		// 400 m away with a 35 degree vertical field of view: 2 * 400 * tan(17.5) = 252.2 m high
		Map<String, Object> view = GoogleEarthWebUrls.cameraView(
				"https://earth.google.com/web/@-1.95,30.06,1500a,400d,35y,30h,0t,0r", 1600, 800);
		assertEquals(-1.95, (Double) view.get("latitude"), 1e-9);
		assertEquals(252.2, (Double) view.get("heightMeters"), 0.1);
		assertEquals(504.5, (Double) view.get("widthMeters"), 0.1);
		assertEquals(30.0, (Double) view.get("heading"), 1e-9);
	}

	@Test
	public void groundAreaOfAViewAimedBelowTheGround() {
		// Aimed at sea level ( 0a ) over ground at 257 m: the camera is 400 - 257 = 143 m above the ground
		Map<String, Object> view = GoogleEarthWebUrls.cameraView(
				"https://earth.google.com/web/@-4.99,151.35,0a,400d,35y,0h,0t,0r", 1600, 800, 257.0);
		assertEquals(2 * 143 * Math.tan(Math.toRadians(17.5)), (Double) view.get("heightMeters"), 0.1);
		// Once Google Earth Web aims at the ground itself the distance is already above the ground
		view = GoogleEarthWebUrls.cameraView(
				"https://earth.google.com/web/@-4.99,151.35,257.1a,400d,35y,0h,0t,0r", 1600, 800, 257.0);
		assertEquals(252.2, (Double) view.get("heightMeters"), 0.1);
	}

	@Test
	public void readsTheAltitudeTheCameraAimsAt() {
		assertEquals(257.13735021, GoogleEarthWebUrls.cameraAltitude(
				"https://earth.google.com/web/@-4.99849986,151.35881491,257.13735021a,343.06d,35y,0h,0t,0r/data=CgRC"), 1e-9);
		assertNull(GoogleEarthWebUrls.cameraAltitude("https://earth.google.com/web/"));
	}

	@Test
	public void readsTheDistanceOfTheCamera() {
		// Sent at 400 m aimed at sea level over a hill of 390 m: Google Earth Web stopped it 10 m from the ground
		assertEquals(9.99999552, GoogleEarthWebUrls.cameraDistance(
				"https://earth.google.com/web/@8.88748226,-10.85569105,0a,9.99999552d,35y,0h,0t,0r/data=CgRCAggB"), 1e-9);
		assertNull(GoogleEarthWebUrls.cameraDistance("https://earth.google.com/web/"));
	}

	@Test
	public void movesTheCameraKeepingItsHeadingAndTilt() {
		// 252.2 m of ground in view from a 35 degree field of view is 400 m away
		assertEquals("https://earth.google.com/web/@-4.5,151.25,257a,400d,35y,30h,0t,0r",
				GoogleEarthWebUrls.movedCameraUrl("https://earth.google.com/web/@-4.99,151.35,257.1a,343d,35y,30h,0t,0r/data=Cg",
						-4.5, 151.25, 2 * 400 * Math.tan(Math.toRadians(17.5)), 257));
		// Not a camera URL yet ( consent page... ): a top-down view
		assertEquals("https://earth.google.com/web/@-4.5,151.25,0a,400d,35y,0h,0t,0r",
				GoogleEarthWebUrls.movedCameraUrl("https://consent.google.com/", -4.5, 151.25,
						2 * 400 * Math.tan(Math.toRadians(17.5)), 0));
	}

	@Test
	public void noGroundAreaForTiltedViewsOrOtherPages() {
		assertNull(GoogleEarthWebUrls.cameraView("https://earth.google.com/web/@-1.95,30.06,1500a,400d,35y,0h,45t,0r", 1600, 800));
		assertNull(GoogleEarthWebUrls.cameraView("https://consent.google.com/ml?continue=x", 1600, 800));
		assertNull(GoogleEarthWebUrls.cameraView(null, 1600, 800));
	}

	@Test
	public void theOtherSourcesShowTheGroundOfThePlotView() {
		// What Google Earth Web shows of a plot, top to bottom: ESRI Wayback is zoomed to show as much
		Map<String, Object> view = GoogleEarthWebUrls.cameraView(GoogleEarthWebUrls.cameraUrl("-4.99", "151.35", 0,
				GoogleEarthWebUrls.PLOT_DISTANCE), 1600, 800);
		assertEquals((Double) view.get("heightMeters"), GoogleEarthWebUrls.plotViewHeightMeters(), 1e-9);
		assertEquals(252.2, GoogleEarthWebUrls.plotViewHeightMeters(), 0.1);
	}

	/** A square plot {@code sideMeters} across, centred on the point */
	static List<List<SimpleCoordinate>> square(double latitude, double longitude, double sideMeters) {
		double halfLatitude = sideMeters / 2 / 111320;
		double halfLongitude = halfLatitude / Math.cos(Math.toRadians(latitude));
		return Collections.singletonList(Arrays.asList(
				new SimpleCoordinate(latitude - halfLatitude, longitude - halfLongitude),
				new SimpleCoordinate(latitude - halfLatitude, longitude + halfLongitude),
				new SimpleCoordinate(latitude + halfLatitude, longitude + halfLongitude),
				new SimpleCoordinate(latitude + halfLatitude, longitude - halfLongitude),
				new SimpleCoordinate(latitude - halfLatitude, longitude - halfLongitude)));
	}

	@Test
	public void thePlotSizeIsItsLargerExtentOnTheGround() {
		assertEquals(30, GoogleEarthWebUrls.extentMeters(square(-1.95, 30.06, 30)), 0.1);
		// degrees of longitude are half as long at 60 degrees: the same plot is 30 m across there too
		assertEquals(30, GoogleEarthWebUrls.extentMeters(square(60, 10, 30)), 0.1);
		// 0.001 degrees of longitude by 0.0002 of latitude, at 60 degrees: 55.7 m east-west, 22.3 m north-south
		List<List<SimpleCoordinate>> wide = Collections.singletonList(Arrays.asList(new SimpleCoordinate(60.0, 10.0),
				new SimpleCoordinate(60.0002, 10.001)));
		assertEquals(55.66, GoogleEarthWebUrls.extentMeters(wide), 0.1);
		// no outline, a single point, or one that cannot be read: no size
		assertEquals(0, GoogleEarthWebUrls.extentMeters(null), 0);
		assertEquals(0, GoogleEarthWebUrls.extentMeters(Collections.singletonList(Arrays.asList(new SimpleCoordinate(1.0, 2.0)))), 0);
		assertEquals(0, GoogleEarthWebUrls.extentMeters(Collections.singletonList(Arrays.asList(new SimpleCoordinate("x", "2"),
				new SimpleCoordinate("1", "3")))), 0);
	}

	@Test
	public void thePlotFillsAboutAThirdOfTheViewHeight() {
		// a plot of 30 m showed on 12% of the view from 400 m: 37.5% from 127 m
		int distance = GoogleEarthWebUrls.plotDistance(30, GoogleEarthWebUrls.PLOT_VIEW_SHARE);
		assertEquals(127, distance);
		double viewHeight = 2 * distance * Math.tan(Math.toRadians(35) / 2);
		assertEquals(0.375, 30 / viewHeight, 0.002);
		// a plot of 100 m, from 423 m; another share asked for
		assertEquals(423, GoogleEarthWebUrls.plotDistance(100, 0.375));
		assertEquals(317, GoogleEarthWebUrls.plotDistance(100, 0.5));
	}

	@Test
	public void thePlotDistanceStaysWithinSaneLimits() {
		// a point plot of 2 m, and a polygon of 5 km
		assertEquals(60, GoogleEarthWebUrls.plotDistance(2, 0.375));
		assertEquals(4000, GoogleEarthWebUrls.plotDistance(5000, 0.375));
		// no size known: the distance of old
		assertEquals(GoogleEarthWebUrls.PLOT_DISTANCE, GoogleEarthWebUrls.plotDistance(0, 0.375));
		assertEquals(GoogleEarthWebUrls.PLOT_DISTANCE, GoogleEarthWebUrls.plotDistance(Double.NaN, 0.375));
		// a share that makes no sense is the default one
		assertEquals(127, GoogleEarthWebUrls.plotDistance(30, 0));
		assertEquals(127, GoogleEarthWebUrls.plotDistance(30, 40));
	}
}
