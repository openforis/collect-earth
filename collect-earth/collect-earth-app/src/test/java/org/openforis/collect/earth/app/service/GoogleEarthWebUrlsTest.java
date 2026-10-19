package org.openforis.collect.earth.app.service;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

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
}
