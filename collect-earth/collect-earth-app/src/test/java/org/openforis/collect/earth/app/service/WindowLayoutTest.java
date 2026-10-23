package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.awt.Dimension;
import java.awt.Insets;
import java.awt.Rectangle;
import java.util.Arrays;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.WindowLayoutService.ImageryPlacement;
import org.openforis.collect.earth.app.service.WindowLayoutService.Mode;
import org.openforis.collect.earth.app.service.WindowLayoutService.Plan;

/** Which screens the plots map and imagery windows go to ({@link WindowLayoutService}). */
public class WindowLayoutTest {

	private static final Rectangle LAPTOP = new Rectangle(0, 0, 1366, 768);
	private static final Rectangle MONITOR = new Rectangle(1366, 0, 2560, 1440);
	private static final Rectangle SAME_SIZE = new Rectangle(1366, 0, 1366, 768);

	@Test
	public void theImageryWindowKeepsHowEachLayoutPlacedIt() {
		assertEquals(ImageryPlacement.NORMAL, WindowLayoutService.imageryPlacement(Mode.SIDE_BY_SIDE));
		assertEquals(ImageryPlacement.MAXIMIZED, WindowLayoutService.imageryPlacement(Mode.SEPARATE_SCREENS));
		assertEquals(ImageryPlacement.FULL_SCREEN, WindowLayoutService.imageryPlacement(Mode.IMAGERY_FULL_SCREEN));
	}

	@Test
	public void oneScreenLeavesThePlotsMapNextToGoogleEarthWeb() {
		assertArrayEquals(new int[] { 0, -1 }, WindowLayoutService.chooseScreens(new Rectangle[] { LAPTOP }, 0));
	}

	@Test
	public void googleEarthWebTakesTheLargestScreen() {
		assertArrayEquals(new int[] { 1, 0 }, WindowLayoutService.chooseScreens(new Rectangle[] { LAPTOP, MONITOR }, 0));
		// The large monitor is the main screen: the plots map goes to the laptop
		assertArrayEquals(new int[] { 1, 0 }, WindowLayoutService.chooseScreens(new Rectangle[] { LAPTOP, MONITOR }, 1));
	}

	@Test
	public void screensOfTheSameSizeKeepTheMainOneForTheForm() {
		assertArrayEquals(new int[] { 1, 0 }, WindowLayoutService.chooseScreens(new Rectangle[] { LAPTOP, SAME_SIZE }, 0));
		assertArrayEquals(new int[] { 0, 1 }, WindowLayoutService.chooseScreens(new Rectangle[] { LAPTOP, SAME_SIZE }, 1));
	}

	@Test
	public void onASmallScreenTheFormIsNarrowAndTheImageryGetsTheRest() {
		assertEquals(420, WindowLayoutService.formWindowWidth(1366));
		assertEquals(420, WindowLayoutService.formWindowWidth(1280));
		assertEquals(480, WindowLayoutService.formWindowWidth(1600));
		assertEquals(560, WindowLayoutService.formWindowWidth(1920));
		assertEquals(560, WindowLayoutService.formWindowWidth(3840));
		// Never more than half of a very small screen
		assertEquals(400, WindowLayoutService.formWindowWidth(800));
	}

	@Test
	public void withThreeScreensThePlotsMapStaysOnTheMainOne() {
		Rectangle third = new Rectangle(-1920, 0, 1920, 1080);
		assertArrayEquals(new int[] { 1, 0 },
				WindowLayoutService.chooseScreens(new Rectangle[] { LAPTOP, MONITOR, third }, 0));
		// The main screen is the largest: the plots map goes to the larger of the others
		assertArrayEquals(new int[] { 1, 2 },
				WindowLayoutService.chooseScreens(new Rectangle[] { LAPTOP, MONITOR, third }, 1));
	}

	@Test
	public void autoUsesASecondScreenOnlyWhenItCanHoldThePlotsMap() {
		assertPlan(Mode.SEPARATE_SCREENS, 1, 0, LocalPropertiesService.WINDOW_LAYOUT_AUTO, LAPTOP, MONITOR);
		// A small second screen (a tablet, a projector): both windows on the large one
		Rectangle tiny = new Rectangle(1366, 0, 800, 480);
		assertPlan(Mode.SIDE_BY_SIDE, 0, 0, LocalPropertiesService.WINDOW_LAYOUT_AUTO, LAPTOP, tiny);
		assertPlan(Mode.SEPARATE_SCREENS, 0, 1, LocalPropertiesService.WINDOW_LAYOUT_SEPARATE_SCREENS, LAPTOP, tiny);
	}

	@Test
	public void sideBySideStaysOnTheLargestScreen() {
		assertPlan(Mode.SIDE_BY_SIDE, 1, 1, LocalPropertiesService.WINDOW_LAYOUT_SIDE_BY_SIDE, LAPTOP, MONITOR);
	}

	@Test
	public void imageryFullScreenNeedsTwoScreens() {
		assertPlan(Mode.IMAGERY_FULL_SCREEN, 1, 0, LocalPropertiesService.WINDOW_LAYOUT_IMAGERY_FULL_SCREEN, LAPTOP, MONITOR);
		assertPlan(Mode.SIDE_BY_SIDE, 0, 0, LocalPropertiesService.WINDOW_LAYOUT_IMAGERY_FULL_SCREEN, LAPTOP);
		assertPlan(Mode.SIDE_BY_SIDE, 0, 0, LocalPropertiesService.WINDOW_LAYOUT_SEPARATE_SCREENS, LAPTOP);
	}

	@Test
	public void sideBySideTheImageryTakesTheRoomLeftBesideTheForm() {
		Rectangle work = new Rectangle(0, 0, 1366, 720);
		// The form widened to 600: the imagery gets the 766 px on its right
		assertEquals(new Rectangle(600, 0, 766, 720), WindowLayoutService.besideForm(work, new Rectangle(0, 0, 600, 720)));
		// Moved to the right edge: the imagery goes to the left
		assertEquals(new Rectangle(0, 0, 900, 720), WindowLayoutService.besideForm(work, new Rectangle(900, 0, 466, 720)));
		// Invisible borders past the screen edge are not room
		assertEquals(new Rectangle(500, 0, 866, 720), WindowLayoutService.besideForm(work, new Rectangle(-8, 0, 508, 720)));
	}

	@Test
	public void theImageryDoesNotFollowWhenThereIsNoRoomOrTheFormLeftTheScreen() {
		Rectangle work = new Rectangle(0, 0, 1366, 720);
		// Maximized form
		assertNull(WindowLayoutService.besideForm(work, new Rectangle(-8, -8, 1382, 744)));
		// Room narrower than the imagery needs
		assertNull(WindowLayoutService.besideForm(work, new Rectangle(0, 0, 1100, 720)));
		// Dragged to another screen
		assertNull(WindowLayoutService.besideForm(work, new Rectangle(1400, 0, 420, 720)));
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
	public void sideBySideTheWindowsMeetAndReachTheTaskBar() {
		Insets border = new Insets(0, 7, 7, 7);
		Rectangle work = new Rectangle(0, 0, 1920, 1040);
		Rectangle form = new Rectangle(0, 0, 560, 1040);
		Rectangle imagery = new Rectangle(560, 0, 1360, 1040);
		// Widened left, right and bottom, not at the top: the title bar shows from the top edge
		Rectangle formWindow = WindowLayoutService.withInvisibleBorders(form, border);
		assertEquals(new Rectangle(-7, 0, 574, 1047), formWindow);
		assertEquals(new Rectangle(553, 0, 1374, 1047), WindowLayoutService.withInvisibleBorders(imagery, border));
		assertEquals(form, WindowLayoutService.visiblePart(formWindow, border));
		// Following the form, the imagery window starts where the form shows its edge
		assertEquals(imagery, WindowLayoutService.besideForm(work, WindowLayoutService.visiblePart(formWindow, border)));
		// No border, as before
		assertEquals(form, WindowLayoutService.withInvisibleBorders(form, new Insets(0, 0, 0, 0)));
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

	private static void assertPlan(Mode mode, int imageryScreen, int formScreen, String layout, Rectangle... screens) {
		Plan plan = WindowLayoutService.plan(layout, screens, 0);
		assertEquals(mode, plan.mode, plan.toString());
		assertEquals(imageryScreen, plan.imageryScreen, plan.toString());
		assertEquals(formScreen, plan.formScreen, plan.toString());
	}
}
