package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
	public void theGroundIsLearntFromACameraStoppedShortOverAHill() {
		GoogleEarthWebService gew = new GoogleEarthWebService();
		SimplePlacemarkObject plot = plot(8.887, -10.856, 0);
		String sent = gew.plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE);
		// Aimed at sea level, as nothing is known of the ground there: the camera stays 10 m above the hill of 390 m
		String arrived = sent.replace(",400d,", ",9.99999552d,") + "/data=CgRCAggB";
		assertTrue(gew.learnGroundUnderACameraStoppedShort(arrived, plot));
		assertEquals(390, gew.groundAltitudeNear(8.887, -10.856), 0.01);
		// so the plot is flown to again aimed at the ground
		assertTrue(gew.plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE).contains(",390a,400d,"));
		// Arrived there, nothing is learnt again
		assertFalse(gew.learnGroundUnderACameraStoppedShort(
				gew.plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE).replace(",400d,", ",400.0045d,"), plot));
	}

	@Test
	public void theGroundIsLearntFromACameraStoppedShortAndAimedAtIt() {
		GoogleEarthWebService gew = new GoogleEarthWebService();
		SimplePlacemarkObject plot = plot(8.887482, -10.855691, 0);
		gew.plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE);
		// What Google Earth Web wrote for plot 2213,1, sent at 400 m aimed at sea level
		assertTrue(gew.learnGroundUnderACameraStoppedShort(
				"https://earth.google.com/web/@8.887482,-10.855691,426.27423958a,9.99999118d,35y,0h,0t,0r/data=CgRC", plot));
		assertEquals(426.27423958, gew.groundAltitudeNear(8.8875, -10.8557), 1e-6);
		assertTrue(gew.plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE).contains(",426a,400d,"));
	}

	@Test
	public void aCameraTheUserZoomedInIsNotTakenForOneStoppedShort() {
		GoogleEarthWebService gew = new GoogleEarthWebService();
		SimplePlacemarkObject plot = plot(8.887, -10.856, 0);
		gew.plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE);
		// Zoomed with the wheel, towards the pointer
		assertFalse(gew.learnGroundUnderACameraStoppedShort(camera(8.88702, -10.85601, 391).replace(",400d,", ",10d,"), plot));
		// Zoomed with the keyboard, over the same point, but not as near as Google Earth Web lets it
		assertFalse(gew.learnGroundUnderACameraStoppedShort(camera(8.887, -10.856, 391).replace(",400d,", ",60d,"), plot));
		assertNull(gew.groundAltitudeNear(8.887, -10.856));
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
