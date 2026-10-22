package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.awt.Rectangle;
import java.util.Arrays;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.WindowLayoutService.Mode;
import org.openforis.collect.earth.app.service.WindowLayoutService.Plan;

/** Which screens the plots map and Google Earth Web windows go to ({@link WindowLayoutService}). */
public class WindowLayoutTest {

	private static final Rectangle LAPTOP = new Rectangle(0, 0, 1366, 768);
	private static final Rectangle MONITOR = new Rectangle(1366, 0, 2560, 1440);
	private static final Rectangle SAME_SIZE = new Rectangle(1366, 0, 1366, 768);

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
	public void theOtherImageryWindowsShareTheRoomOfGoogleEarthWeb() {
		Rectangle room = new Rectangle(420, 0, 946, 720);
		assertEquals(Arrays.asList(room), WindowLayoutService.tile(room, 1));
		// Wider than tall: side by side
		assertEquals(Arrays.asList(new Rectangle(420, 0, 473, 720), new Rectangle(893, 0, 473, 720)),
				WindowLayoutService.tile(room, 2));
		// Three: two above, the third alone and as wide as the room below
		assertEquals(Arrays.asList(new Rectangle(420, 0, 473, 360), new Rectangle(893, 0, 473, 360),
				new Rectangle(420, 360, 946, 360)), WindowLayoutService.tile(room, 3));
		// Taller than wide: one above the other
		assertEquals(Arrays.asList(new Rectangle(0, 0, 600, 500), new Rectangle(0, 500, 600, 500)),
				WindowLayoutService.tile(new Rectangle(0, 0, 600, 1000), 2));
	}

	private static void assertPlan(Mode mode, int imageryScreen, int formScreen, String layout, Rectangle... screens) {
		Plan plan = WindowLayoutService.plan(layout, screens, 0);
		assertEquals(mode, plan.mode, plan.toString());
		assertEquals(imageryScreen, plan.imageryScreen, plan.toString());
		assertEquals(formScreen, plan.formScreen, plan.toString());
	}
}
