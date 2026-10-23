package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;

/**
 * The ground altitude {@link GoogleEarthWebService} learns from the camera URLs Google Earth Web writes: never an
 * altitude Collect Earth wrote itself, whatever it wrote since.
 */
public class GoogleEarthWebGroundAltitudeTest {

	private static SimplePlacemarkObject plot(double latitude, double longitude, int elevation) {
		SimplePlacemarkObject plot = new SimplePlacemarkObject(new double[] { latitude, longitude }, "p");
		plot.setElevation(elevation);
		return plot;
	}

	private static String camera(double latitude, double longitude, int altitude) {
		return GoogleEarthWebUrls.cameraUrl(String.valueOf(latitude), String.valueOf(longitude), altitude,
				GoogleEarthWebUrls.PLOT_DISTANCE);
	}

	@Test
	public void theGroundTheUserMovedToIsLearnt() {
		GoogleEarthWebService gew = new GoogleEarthWebService();
		gew.plotUrl(plot(10, 10, 100), GoogleEarthWebUrls.PLOT_DISTANCE);
		gew.learnGroundAltitude(camera(10, 10, 320));
		assertEquals(Double.valueOf(320), gew.groundAltitudeNear(10, 10));
	}

	@Test
	public void aCameraMoveIsNotLearntAfterTheOutlineIsDrawnAgain() {
		GoogleEarthWebService gew = new GoogleEarthWebService();
		gew.plotUrl(plot(10, 10, 100), GoogleEarthWebUrls.PLOT_DISTANCE);
		// The user moved the camera there: the ground is learnt
		gew.learnGroundAltitude(camera(10, 10, 320));
		// The plots map moved the camera far away: Collect Earth guesses the altitude there from the one before
		String moved = gew.movedCameraUrl(camera(10, 10, 320), 20, 20, 1000);
		assertEquals(Double.valueOf(320), GoogleEarthWebUrls.cameraAltitude(moved));
		// The outline is drawn again (a reload, new neighbours), with the plot's top-down view for its button
		gew.topDownUrl(plot(10, 10, 100));
		// Google Earth Web still shows the altitude Collect Earth wrote: not ground it learnt
		gew.learnGroundAltitude(moved);
		assertNull(gew.groundAltitudeNear(20, 20));
	}

	@Test
	public void theTopDownViewOfTheOverlayIsNotLearnt() {
		GoogleEarthWebService gew = new GoogleEarthWebService();
		gew.plotUrl(plot(10, 10, 100), GoogleEarthWebUrls.PLOT_DISTANCE);
		gew.movedCameraUrl(camera(10, 10, 100), 10.01, 10.01, 1000);
		// The user pressed "Top-down view" of a plot with no elevation: Collect Earth's guess, 0
		String topDown = gew.topDownUrl(plot(30, 30, 0));
		gew.learnGroundAltitude(topDown);
		assertNull(gew.groundAltitudeNear(30, 30));
	}
}
