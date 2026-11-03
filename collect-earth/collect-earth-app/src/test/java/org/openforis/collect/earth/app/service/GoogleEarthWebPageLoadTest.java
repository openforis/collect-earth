package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * After a page load Google Earth Web resets the globe before it flies to the camera of the URL: the plot is READY, and
 * its outline drawn, only once the camera is back over it ({@link GoogleEarthWebService#isCameraBackAt}).
 */
public class GoogleEarthWebPageLoadTest {

	@Test
	public void theGlobeGoogleEarthWebStartsWithIsNotThePlot() {
		// What a page load of plot id_12,1 wrote, in order (measured)
		assertFalse(GoogleEarthWebService.isCameraBackAt("https://earth.google.com/web/@0,0,0a,0d,0y,0h,0t,0r",
				14.464809, -0.125032));
		assertFalse(GoogleEarthWebService.isCameraBackAt(
				"https://earth.google.com/web/@0,0,0a,22251752.77375655d,35y,0h,0t,0r", 14.464809, -0.125032));
		assertTrue(GoogleEarthWebService.isCameraBackAt(
				"https://earth.google.com/web/@14.464809,-0.125032,0a,128d,35y,0h,0t,0r/data=CgRCAggB", 14.464809,
				-0.125032));
	}

	@Test
	public void aPlotSeenFromTheHeightOfTheGlobeIsNotBack() {
		assertFalse(GoogleEarthWebService.isCameraBackAt(
				"https://earth.google.com/web/@14.464809,-0.125032,0a,22251752.77d,35y,0h,0t,0r", 14.464809, -0.125032));
	}

	@Test
	public void aCameraOverAnotherPlotIsNotBack() {
		assertFalse(GoogleEarthWebService.isCameraBackAt(
				"https://earth.google.com/web/@15.972537,-16.325393,0a,128d,35y,0h,0t,0r", 14.464809, -0.125032));
		assertFalse(GoogleEarthWebService.isCameraBackAt("https://earth.google.com/web/", 14.464809, -0.125032));
	}
}
