package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.awt.Dimension;
import java.awt.Insets;
import java.awt.Rectangle;
import java.util.Arrays;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.WindowLayoutService.ImageryPlacement;
import org.openforis.collect.earth.app.service.WindowLayoutService.Plan;

/** Which screens the imagery windows go to ({@link WindowLayoutService}). */
public class WindowLayoutTest {

	private static final Rectangle LAPTOP = new Rectangle(0, 0, 1366, 768);
	private static final Rectangle MONITOR = new Rectangle(1366, 0, 2560, 1440);
	private static final Rectangle SAME_SIZE = new Rectangle(1366, 0, 1366, 768);

	@Test
	public void googleEarthWebTakesTheLargestScreenAndTheOtherSourcesAnother() {
		Plan plan = WindowLayoutService.plan(new Rectangle[] { LAPTOP, MONITOR }, 0);
		assertEquals(1, plan.imageryScreen);
		assertEquals(0, plan.othersScreen);
		assertEquals(ImageryPlacement.MAXIMIZED, WindowLayoutService.othersPlacement(plan));
		// Screens of the same size: the main one, with the task bar and Collect Earth
		plan = WindowLayoutService.plan(new Rectangle[] { LAPTOP, SAME_SIZE }, 1);
		assertEquals(1, plan.imageryScreen);
		assertEquals(0, plan.othersScreen);
		// Three screens: the other sources on the larger of the others
		Rectangle third = new Rectangle(-1920, 0, 1920, 1080);
		plan = WindowLayoutService.plan(new Rectangle[] { LAPTOP, MONITOR, third }, 0);
		assertEquals(1, plan.imageryScreen);
		assertEquals(2, plan.othersScreen);
		// One screen: the other sources over Google Earth Web, beside the panel
		plan = WindowLayoutService.plan(new Rectangle[] { LAPTOP }, 0);
		assertEquals(0, plan.imageryScreen);
		assertEquals(0, plan.othersScreen);
		assertEquals(ImageryPlacement.NORMAL, WindowLayoutService.othersPlacement(plan));
	}

	@Test
	public void onASingleScreenTheOtherSourcesLeaveThePanelInSight() {
		assertEquals(420, WindowLayoutService.othersLeftOfPanel(420, 1366));
		// Not there yet: where it opens
		assertEquals(560, WindowLayoutService.othersLeftOfPanel(0, 1920));
		// A wide panel leaves the other sources half of the screen
		assertEquals(683, WindowLayoutService.othersLeftOfPanel(900, 1366));
	}

	@Test
	public void theInvisibleBordersAreMeasuredFromThePage() {
		// Measured on Windows 10 at 100 %, windows at 0,0 800x600: Firefox 158 and a Chrome --app window. Their frame
		// shows from 7 px in on the left, right and bottom; outer minus inner is 8 a side, with the 1 px that shows.
		assertEquals(7, border(800, 784, 600, 519, 0, 0, 8.0, 73.0, 1));
		assertEquals(7, border(800, 784, 600, 505, 0, 0, null, null, 1));
		// At 150 %: 7 px of the browser hidden, 1 px of the screen (2/3 px) showing
		assertEquals(7, border(800, 784.67, 600, 519, 0, 0, null, null, 1.5));
		// A Firefox side bar widens only the outer minus inner width: the other figures hold
		assertEquals(7, border(800, 484, 600, 519, 0, 0, 308.0, 73.0, 1));
	}

	@Test
	public void noInvisibleBorderWhenItCannotBeTold() {
		// macOS, Linux: the page fills the window
		assertEquals(0, border(1200, 1200, 800, 720, 0, 25, null, null, 2));
		// Docked developer tools, a zoomed in page (Chrome), a zoomed out one
		assertEquals(0, border(800, 400, 600, 505, 0, 0, null, null, 1));
		assertEquals(0, border(800, 627, 600, 404, 0, 0, null, null, 1.25));
		assertEquals(0, border(800, 980, 600, 650, 0, 0, null, null, 0.8));
		// Nothing measured
		assertEquals(0, WindowLayoutService.invisibleBorder(null));
		assertEquals(0, WindowLayoutService.invisibleBorder(Arrays.asList((Object) null)));
	}

	@Test
	public void theWindowBesideThePanelReachesTheTaskBar() {
		Insets border = new Insets(0, 7, 7, 7);
		Rectangle others = new Rectangle(560, 0, 1360, 1040);
		// Widened left, right and bottom, not at the top: the title bar shows from the top edge
		assertEquals(new Rectangle(553, 0, 1374, 1047), WindowLayoutService.withInvisibleBorders(others, border));
		// No border, as before
		assertEquals(others, WindowLayoutService.withInvisibleBorders(others, new Insets(0, 0, 0, 0)));
	}

	@Test
	public void theWorkAreaReachesTheTaskBarWhenFirefoxGivesItShort() {
		// Firefox 158 gives 1920x1032 for a work area of 1920x1040 (task bar of 40 px)
		Rectangle bounds = new Rectangle(0, 0, 1920, 1080);
		Rectangle javaWork = new Rectangle(0, 0, 1920, 1040);
		assertEquals(javaWork, WindowLayoutService.correctedWorkArea(new Rectangle(0, 0, 1920, 1032),
				new Dimension(1920, 1080), bounds, javaWork));
		// A screen that is not the main one, at its place
		assertEquals(new Rectangle(1920, 241, 1366, 728), WindowLayoutService.correctedWorkArea(
				new Rectangle(1920, 241, 1366, 720), new Dimension(1366, 768), new Rectangle(1920, 241, 1366, 768),
				new Rectangle(1920, 241, 1366, 728)));
		// The browser's px are Java's at 150 %: Java's figures scaled alike
		assertEquals(new Rectangle(0, 0, 1280, 693), WindowLayoutService.correctedWorkArea(new Rectangle(0, 0, 1280, 688),
				new Dimension(1280, 720), bounds, javaWork));
		// Chrome gives it right: kept
		assertEquals(javaWork, WindowLayoutService.correctedWorkArea(javaWork, new Dimension(1920, 1080), bounds, javaWork));
	}

	@Test
	public void theWorkAreaIsKeptWhenJavaDoesNotMatch() {
		Rectangle bounds = new Rectangle(0, 0, 1920, 1080);
		// Another screen than Java's
		assertEquals(new Rectangle(0, 0, 1280, 1014), WindowLayoutService.correctedWorkArea(new Rectangle(0, 0, 1280, 1014),
				new Dimension(1280, 1024), bounds, new Rectangle(0, 0, 1920, 1040)));
		// Too far from Java's: something else (a docked bar Java does not see as such)
		assertEquals(new Rectangle(0, 0, 1920, 1000), WindowLayoutService.correctedWorkArea(new Rectangle(0, 0, 1920, 1000),
				new Dimension(1920, 1080), bounds, new Rectangle(0, 0, 1920, 1040)));
		// Smaller in Java: the browser's is kept
		assertEquals(new Rectangle(0, 0, 1920, 1040), WindowLayoutService.correctedWorkArea(new Rectangle(0, 0, 1920, 1040),
				new Dimension(1920, 1080), bounds, new Rectangle(0, 0, 1920, 1000)));
	}

	@Test
	public void aTaskBarOnTheTopOrTheLeftIsNotReachedPast() {
		Rectangle bounds = new Rectangle(0, 0, 1920, 1080);
		// Task bar of 40 px on the top: the browser starting the work area where Java does is corrected as at the bottom
		Rectangle javaTop = new Rectangle(0, 40, 1920, 1040);
		assertEquals(javaTop, WindowLayoutService.correctedWorkArea(new Rectangle(0, 40, 1920, 1032),
				new Dimension(1920, 1080), bounds, javaTop));
		// but one starting it lower is not made taller, which would reach past the bottom of the screen
		assertEquals(new Rectangle(0, 48, 1920, 1032), WindowLayoutService.correctedWorkArea(new Rectangle(0, 48, 1920, 1032),
				new Dimension(1920, 1080), bounds, javaTop));
		// Task bar of 60 px on the left, alike
		Rectangle javaLeft = new Rectangle(60, 0, 1860, 1080);
		assertEquals(javaLeft, WindowLayoutService.correctedWorkArea(new Rectangle(60, 0, 1852, 1080),
				new Dimension(1920, 1080), bounds, javaLeft));
		assertEquals(new Rectangle(68, 0, 1852, 1080), WindowLayoutService.correctedWorkArea(new Rectangle(68, 0, 1852, 1080),
				new Dimension(1920, 1080), bounds, javaLeft));
		// At 150 %, Java's origin scaled alike
		assertEquals(new Rectangle(0, 27, 1280, 693), WindowLayoutService.correctedWorkArea(new Rectangle(0, 27, 1280, 688),
				new Dimension(1280, 720), bounds, javaTop));
	}

	private static int border(double outerWidth, double innerWidth, double outerHeight, double innerHeight, double screenX,
			double screenY, Double pageX, Double pageY, double pixelRatio) {
		return WindowLayoutService.invisibleBorder(Arrays.asList(outerWidth, innerWidth, outerHeight, innerHeight, screenX,
				screenY, pageX, pageY, pixelRatio));
	}
}
