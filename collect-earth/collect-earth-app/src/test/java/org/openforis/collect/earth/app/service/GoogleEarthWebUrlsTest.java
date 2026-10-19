package org.openforis.collect.earth.app.service;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Map;

import org.junit.Test;

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
	public void noGroundAreaForTiltedViewsOrOtherPages() {
		assertNull(GoogleEarthWebUrls.cameraView("https://earth.google.com/web/@-1.95,30.06,1500a,400d,35y,0h,45t,0r", 1600, 800));
		assertNull(GoogleEarthWebUrls.cameraView("https://consent.google.com/ml?continue=x", 1600, 800));
		assertNull(GoogleEarthWebUrls.cameraView(null, 1600, 800));
	}
}
