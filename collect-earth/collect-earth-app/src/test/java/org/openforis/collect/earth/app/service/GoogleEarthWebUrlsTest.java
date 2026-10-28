package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;

import org.junit.jupiter.api.Test;

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
}
