package org.openforis.collect.earth.app.service;

import java.awt.GraphicsConfiguration;
import java.awt.GraphicsDevice;
import java.awt.GraphicsEnvironment;
import java.awt.Insets;
import java.awt.Rectangle;
import java.awt.Toolkit;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import org.openforis.collect.earth.app.service.imagery.ImageryBrowser;
import org.openqa.selenium.Dimension;
import org.openqa.selenium.Point;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Lays out the plots map and the imagery window (Google Earth Web and the other imagery sources, a tab each, see
 * {@link ImageryBrowser}) so that the imagery gets as much room as possible, following the window layout chosen in the
 * options (LocalPropertiesService.getWindowLayout):
 *
 * <ul>
 * <li>Separate screens: the imagery window maximized on the largest screen (full screen with the "imagery full screen"
 * layout), the plots map maximized on another one - the main screen, unless the imagery window took it.</li>
 * <li>Side by side: the plots map narrowed to the width of the form on the left, which it then shows on its own (the
 * page switches to that layout when it is too narrow for its map, see App.tsx), the imagery window on the rest.</li>
 * </ul>
 *
 * Java only says which screen is which. Where a window goes on a screen is measured by the browser itself, in its own
 * coordinates (the work area of the screen the window is on), and every placement is read back and corrected once:
 * with screens of different scalings, Java's and the browser's coordinates do not agree, and the system may move or
 * resize a window on its own (snapping, minimum sizes).
 *
 * <p>The layout is kept: it is applied again whenever a browser for the imagery window starts (the first time, or
 * after the user closed it), when the plots map asks (it opened, or the user chose "Arrange"), and when screens are
 * added, removed or resized (e.g. a laptop docked or undocked) while the windows are open. Side by side, the imagery
 * window follows the plots map window: when the user resizes or moves it, the imagery window takes the room left beside
 * it. A new tab needs nothing: the tabs share their window.</p>
 *
 * <p>Only with the plots map as the viewer; the classic viewer (Google Earth Pro) leaves the browser windows where they
 * open.</p>
 *
 * <p>Threads: every classic WebDriver call on the windows is made holding {@link #lock}, as neither driver is safe to
 * use from two threads at once (see {@link ImageryBrowser#window()}).</p>
 */
@Component
public class WindowLayoutService {

	enum Mode { SIDE_BY_SIDE, SEPARATE_SCREENS, IMAGERY_FULL_SCREEN }

	/** Where the windows go: the mode, and the screen of each window (the same one side by side). */
	static final class Plan {
		final Mode mode;
		final int imageryScreen;
		final int formScreen;

		Plan(Mode mode, int imageryScreen, int formScreen) {
			this.mode = mode;
			this.imageryScreen = imageryScreen;
			this.formScreen = formScreen;
		}

		@Override
		public String toString() {
			return mode + " imagery on screen " + imageryScreen + ", form on screen " + formScreen;
		}
	}

	/**
	 * Width of the plots map window next to the imagery window, as a share of the screen and within
	 * {@link #MIN_FORM_WINDOW_WIDTH} - {@link #MAX_FORM_WINDOW_WIDTH}.
	 */
	private static final double FORM_WINDOW_SHARE = 0.3;
	/** The narrowest the form still reads well in (its compact layout starts at 480 px, see FormApp.tsx). */
	private static final int MIN_FORM_WINDOW_WIDTH = 420;
	/** The form's default width: wider only takes room from the imagery. */
	private static final int MAX_FORM_WINDOW_WIDTH = 560;
	/** "auto" puts the imagery window on a screen of its own only when the other screen can hold the plots map. */
	private static final int MIN_FORM_SCREEN_WIDTH = 1024;
	private static final int MIN_FORM_SCREEN_HEIGHT = 600;
	/** A window this far from where it was asked to go (in px) is moved once more. */
	private static final int PLACEMENT_TOLERANCE = 2;
	private static final long SCREEN_CHECK_PERIOD_SECONDS = 2;
	/** Side by side, the imagery window is not squeezed narrower than this to follow the plots map window. */
	private static final int MIN_IMAGERY_WIDTH = 320;

	/** The work area (screen minus task bar / dock) of the screen the window is on, in the browser's coordinates. */
	private static final String WORK_AREA_SCRIPT = "return [screen.availLeft || 0, screen.availTop || 0, screen.availWidth, screen.availHeight];";

	private final Logger logger = LoggerFactory.getLogger(WindowLayoutService.class);

	@Autowired
	private BrowserService browserService;

	@Autowired
	private ImageryBrowser imageryBrowser;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private final Object lock = new Object();
	private ScheduledExecutorService screenWatcher;
	/** The screens the windows were last laid out on (see {@link #screensSignature}). */
	private volatile String arrangedOn;
	/** The screens at the previous check of the watcher. */
	private String lastSeen;
	/** Side by side: the work area the windows share, in the browser's coordinates; null in the other layouts. */
	private volatile Rectangle sideBySideWorkArea;

	/**
	 * Lays out every new imagery window. Not on the thread that tells of it, which also tells the imagery services
	 * that a tab was shown: placing the windows takes a few seconds of WebDriver calls.
	 */
	@PostConstruct
	void layOutNewImageryWindows() {
		imageryBrowser.onBrowserStarted(() -> {
			Thread thread = new Thread(this::arrange, "Imagery window layout");
			thread.setDaemon(true);
			thread.start();
		});
	}

	/**
	 * Lays out the windows that are open, where they are in the stack of windows (when one opens, when the screens
	 * change). Does nothing unless the plots map is the plot viewer: the classic viewer leaves the windows where they
	 * open.
	 */
	public boolean arrange() {
		return arrange(false);
	}

	/** As {@link #arrange()}, and brings the windows in front of the others: the user asked for them. */
	public boolean arrangeAndBringForward() {
		return arrange(true);
	}

	/**
	 * @param bringForward whether to raise the windows above the others. WebDriver has no call for that, and Windows does
	 *                     not let a program in the background (the browser) put itself in front; restoring a minimized
	 *                     window does, so each window is minimized and restored before it is placed. It blinks: only
	 *                     when the user asks.
	 */
	private boolean arrange(boolean bringForward) {
		if (!localPropertiesService.isPlotsMapViewer() || GraphicsEnvironment.isHeadless()) {
			return false;
		}
		synchronized (lock) {
			RemoteWebDriver map = browserService.getLeafletMapDriver();
			RemoteWebDriver imagery = imageryBrowser.window();
			if (map == null && imagery == null) {
				return false;
			}
			try {
				GraphicsEnvironment env = GraphicsEnvironment.getLocalGraphicsEnvironment();
				GraphicsDevice primary = env.getDefaultScreenDevice();
				GraphicsDevice[] screens = env.getScreenDevices();
				Rectangle[] workAreas = new Rectangle[screens.length];
				int primaryIndex = 0;
				for (int i = 0; i < screens.length; i++) {
					workAreas[i] = workArea(screens[i].getDefaultConfiguration());
					if (screens[i].equals(primary)) {
						primaryIndex = i;
					}
				}
				Plan plan = plan(localPropertiesService.getWindowLayout(), workAreas, primaryIndex);
				logger.info("Arranging the plots map and imagery windows: {} ({} screens)", plan, screens.length);
				sideBySideWorkArea = null;
				switch (plan.mode) {
				case SIDE_BY_SIDE:
					sideBySideWorkArea = placeSideBySide(map, imagery, workAreas[plan.imageryScreen], bringForward);
					break;
				case IMAGERY_FULL_SCREEN:
					maximizeOn(map, workAreas[plan.formScreen], false, bringForward);
					maximizeOn(imagery, workAreas[plan.imageryScreen], true, bringForward);
					break;
				default:
					maximizeOn(map, workAreas[plan.formScreen], false, bringForward);
					maximizeOn(imagery, workAreas[plan.imageryScreen], false, bringForward);
				}
				arrangedOn = screensSignature();
				startScreenWatcher();
				return true;
			} catch (Exception e) {
				logger.warn("Could not arrange the plots map and imagery windows", e);
				return false;
			}
		}
	}

	/**
	 * Side by side, after the user resized or moved the plots map window: the imagery window takes the room left beside it
	 * (the wider side), the whole height of the screen. Nothing happens in the other layouts, when the plots map left the
	 * screen they share, or when the room left is too narrow for the imagery (e.g. the plots map was maximized).
	 */
	public void followFormWindow() {
		if (sideBySideWorkArea == null) {
			return;
		}
		synchronized (lock) {
			Rectangle work = sideBySideWorkArea;
			RemoteWebDriver map = browserService.getLeafletMapDriver();
			RemoteWebDriver imagery = work == null ? null : imageryBrowser.window();
			if (map == null || imagery == null) {
				return;
			}
			try {
				Rectangle form = rectangleOf(map);
				Rectangle target = besideForm(work, form);
				if (target == null) {
					logger.debug("No room for the imagery window beside the plots map at {}", form);
					return;
				}
				if (!isAt(rectangleOf(imagery), target)) {
					placeExactly(imagery, target);
				}
			} catch (Exception e) {
				logger.debug("The imagery window could not follow the plots map window", e);
			}
		}
	}

	@PreDestroy
	public void stopScreenWatcher() {
		if (screenWatcher != null) {
			screenWatcher.shutdownNow();
		}
	}

	// ---------- the plan (no windows involved: tested in WindowLayoutTest) ----------

	/** Where each window goes for this layout on these screens (work areas). */
	static Plan plan(String layout, Rectangle[] screens, int primary) {
		int[] chosen = chooseScreens(screens, primary);
		int imagery = chosen[0];
		int form = chosen[1];
		if (form < 0 || LocalPropertiesService.WINDOW_LAYOUT_SIDE_BY_SIDE.equals(layout)) {
			return new Plan(Mode.SIDE_BY_SIDE, imagery, imagery);
		}
		if (LocalPropertiesService.WINDOW_LAYOUT_IMAGERY_FULL_SCREEN.equals(layout)) {
			return new Plan(Mode.IMAGERY_FULL_SCREEN, imagery, form);
		}
		if (LocalPropertiesService.WINDOW_LAYOUT_SEPARATE_SCREENS.equals(layout)
				|| screens[form].width >= MIN_FORM_SCREEN_WIDTH && screens[form].height >= MIN_FORM_SCREEN_HEIGHT) {
			return new Plan(Mode.SEPARATE_SCREENS, imagery, form);
		}
		// "auto" with only a small second screen: both on the large one
		return new Plan(Mode.SIDE_BY_SIDE, imagery, imagery);
	}

	/**
	 * Which screens the windows go to: {imagery window, plots map}. The imagery window gets the largest screen (not the
	 * main one when another is as large: that keeps the main one, with the task bar and Collect Earth, for the form),
	 * the plots map the main screen, or else the largest of the others; -1 for the plots map when there is only one
	 * screen.
	 */
	static int[] chooseScreens(Rectangle[] screens, int primary) {
		int largest = primary;
		for (int i = 0; i < screens.length; i++) {
			long area = area(screens[i]);
			long largestArea = area(screens[largest]);
			if (area > largestArea || area == largestArea && largest == primary && i != primary) {
				largest = i;
			}
		}
		int form = largest == primary ? -1 : primary;
		if (form < 0) {
			for (int i = 0; i < screens.length; i++) {
				if (i != largest && (form < 0 || area(screens[i]) > area(screens[form]))) {
					form = i;
				}
			}
		}
		return new int[] { largest, form };
	}

	/** Width of the plots map window next to the imagery window on a screen this wide (never over half of it). */
	static int formWindowWidth(int screenWidth) {
		int width = (int) Math.round(screenWidth * FORM_WINDOW_SHARE);
		return Math.min(Math.max(width, MIN_FORM_WINDOW_WIDTH), Math.min(MAX_FORM_WINDOW_WIDTH, screenWidth / 2));
	}

	/**
	 * The room left in the work area beside the form window, on its wider side, the whole height; null when the form is
	 * mostly off that screen or the room is narrower than {@link #MIN_IMAGERY_WIDTH}.
	 */
	static Rectangle besideForm(Rectangle work, Rectangle form) {
		// A window's rectangle includes its invisible borders: only being mostly elsewhere means it left the screen
		Rectangle shared = work.intersection(form);
		if (shared.isEmpty() || (long) shared.width * shared.height * 2 < (long) form.width * form.height) {
			return null;
		}
		int formLeft = Math.max(form.x, work.x);
		int formRight = Math.min(form.x + form.width, work.x + work.width);
		int roomLeft = formLeft - work.x;
		int roomRight = work.x + work.width - formRight;
		Rectangle room = roomRight >= roomLeft ? new Rectangle(formRight, work.y, roomRight, work.height)
				: new Rectangle(work.x, work.y, roomLeft, work.height);
		return room.width >= MIN_IMAGERY_WIDTH ? room : null;
	}

	private static long area(Rectangle bounds) {
		return (long) bounds.width * bounds.height;
	}

	// ---------- placing the windows ----------

	/**
	 * The form on the left of the screen, the imagery on the rest; each measured by its own browser. Returns the work area
	 * they share, in the browser's coordinates.
	 */
	private Rectangle placeSideBySide(RemoteWebDriver map, RemoteWebDriver imagery, Rectangle screen, boolean bringForward) {
		RemoteWebDriver measuring = map != null ? map : imagery;
		Rectangle work = measureWorkArea(measuring, screen);
		int formWidth = formWindowWidth(work.width);
		if (map != null) {
			if (bringForward) {
				bringForwardLocked(map);
			}
			placeExactly(map, new Rectangle(work.x, work.y, formWidth, work.height));
		}
		if (imagery != null) {
			Rectangle imageryWork = imagery == measuring ? work : measureWorkArea(imagery, screen);
			if (bringForward) {
				bringForwardLocked(imagery);
			}
			placeExactly(imagery, new Rectangle(imageryWork.x + formWidth, imageryWork.y, imageryWork.width - formWidth,
					imageryWork.height));
		}
		return work;
	}

	/**
	 * Moves the window onto the screen and maximizes it (or makes it full screen) there: the browser then fits it to that
	 * screen itself.
	 */
	private void maximizeOn(RemoteWebDriver window, Rectangle screen, boolean fullScreen, boolean bringForward) {
		if (window == null) {
			return;
		}
		Rectangle work = measureWorkArea(window, screen);
		if (bringForward) {
			bringForwardLocked(window);
		}
		WebDriver.Window w = window.manage().window();
		if (fullScreen) {
			w.fullscreen();
		} else {
			w.maximize();
		}
		Point position = w.getPosition();
		Dimension size = w.getSize();
		// A maximized window overlaps the edges of the work area by its invisible borders: only being elsewhere matters
		if (!work.intersects(new Rectangle(position.x, position.y, size.width, size.height))) {
			logger.warn("The window was asked to fill the screen at {} but is at {} {}", work, position, size);
		}
	}

	/**
	 * Puts the window inside the screen (in Java's coordinates, close enough to land on it), then asks the browser for
	 * the work area of the screen it is now on, in the browser's own coordinates. Falls back to Java's figures when the
	 * browser gives none.
	 */
	private Rectangle measureWorkArea(RemoteWebDriver window, Rectangle screen) {
		WebDriver.Window w = window.manage().window();
		// Setting the size first also brings a maximized or full screen window back to normal before it moves
		w.setSize(new Dimension(Math.min(800, screen.width / 2), Math.min(600, screen.height / 2)));
		w.setPosition(new Point(screen.x + screen.width / 4, screen.y + screen.height / 4));
		Rectangle work = readWorkArea(window);
		if (work == null) {
			return screen;
		}
		logger.debug("Screen work area {} in Java is {} in the browser", screen, work);
		return work;
	}

	/**
	 * The work area of the screen the window is on, in the browser's coordinates; null when the browser gives none.
	 * Firefox gives the work area of a screen that is not the main one from 0,0: when the area does not hold the window,
	 * its size is kept and its corner is taken from the screen Java sees under the window.
	 */
	private Rectangle readWorkArea(RemoteWebDriver window) {
		try {
			List<?> area = (List<?>) window.executeScript(WORK_AREA_SCRIPT);
			Rectangle work = new Rectangle(intAt(area, 0), intAt(area, 1), intAt(area, 2), intAt(area, 3));
			if (work.width <= 0 || work.height <= 0) {
				return null;
			}
			Rectangle placed = rectangleOf(window);
			int centerX = placed.x + placed.width / 2;
			int centerY = placed.y + placed.height / 2;
			if (!work.contains(centerX, centerY)) {
				Rectangle screen = javaWorkAreaAt(centerX, centerY);
				if (screen != null) {
					logger.debug("The browser gave the work area {} away from its window at {}: on the screen at {}", work,
							placed, screen);
					work.setLocation(screen.x, screen.y);
				}
			}
			return work;
		} catch (Exception e) {
			logger.debug("The browser did not say which screen it is on", e);
			return null;
		}
	}

	/** The work area, as Java sees it, of the screen holding this point; null when none does. */
	private static Rectangle javaWorkAreaAt(int x, int y) {
		for (GraphicsDevice screen : GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices()) {
			GraphicsConfiguration configuration = screen.getDefaultConfiguration();
			if (configuration.getBounds().contains(x, y)) {
				return workArea(configuration);
			}
		}
		return null;
	}

	/**
	 * Brings the window in front of the others: minimizes it and restores it where it was (see
	 * {@link #arrange(boolean)}). Restored by moving it back, which WebDriver does by restoring the window first: asked to
	 * maximize a minimized window, Firefox can leave it minimized. Holds {@link #lock}, as every classic call on the
	 * windows does; a window from {@link ImageryBrowser#window()} should be asked for holding it too.
	 */
	public void bringForward(RemoteWebDriver window) {
		synchronized (lock) {
			bringForwardLocked(window);
		}
	}

	/**
	 * Brings the imagery window in front of the others, if it is open: the user picked one of its sources in the plots
	 * map, which is in front then. The window is asked for holding {@link #lock}, see {@link ImageryBrowser#window()}.
	 */
	public void bringImageryWindowForward() {
		synchronized (lock) {
			RemoteWebDriver imagery = imageryBrowser.window();
			if (imagery != null) {
				bringForwardLocked(imagery);
			}
		}
	}

	private void bringForwardLocked(RemoteWebDriver window) {
		// Side effect: minimized, the page is hidden for a moment and then visible again, so its visibility listeners
		// fire (Google Earth Web redraws its plot once). The imagery browser takes it as the tab shown again.
		try {
			WebDriver.Window w = window.manage().window();
			Point position = w.getPosition();
			Dimension size = w.getSize();
			w.minimize();
			w.setPosition(position);
			w.setSize(size);
		} catch (Exception e) {
			logger.debug("Could not bring the window forward", e);
		}
	}

	/** Places the window, reads back where it went and corrects once by the difference. */
	private void placeExactly(RemoteWebDriver window, Rectangle target) {
		WebDriver.Window w = window.manage().window();
		w.setPosition(new Point(target.x, target.y));
		w.setSize(new Dimension(target.width, target.height));
		Point position = w.getPosition();
		Dimension size = w.getSize();
		int dx = target.x - position.x;
		int dy = target.y - position.y;
		int dw = target.width - size.width;
		int dh = target.height - size.height;
		if (Math.max(Math.max(Math.abs(dx), Math.abs(dy)), Math.max(Math.abs(dw), Math.abs(dh))) > PLACEMENT_TOLERANCE) {
			w.setPosition(new Point(target.x + dx, target.y + dy));
			w.setSize(new Dimension(target.width + dw, target.height + dh));
			logger.debug("Window asked for {} went to {} {}; corrected to {} {}", target, position, size, w.getPosition(),
					w.getSize());
		} else {
			logger.debug("Window placed at {}", target);
		}
	}

	private static Rectangle rectangleOf(RemoteWebDriver window) {
		WebDriver.Window w = window.manage().window();
		Point position = w.getPosition();
		Dimension size = w.getSize();
		return new Rectangle(position.x, position.y, size.width, size.height);
	}

	private static boolean isAt(Rectangle current, Rectangle target) {
		return Math.abs(current.x - target.x) <= PLACEMENT_TOLERANCE && Math.abs(current.y - target.y) <= PLACEMENT_TOLERANCE
				&& Math.abs(current.width - target.width) <= PLACEMENT_TOLERANCE
				&& Math.abs(current.height - target.height) <= PLACEMENT_TOLERANCE;
	}

	private static int intAt(List<?> values, int index) {
		Object value = values.get(index);
		return value instanceof Number ? (int) Math.round(((Number) value).doubleValue()) : 0;
	}

	/** Screen bounds minus the task bar / dock. */
	private static Rectangle workArea(GraphicsConfiguration configuration) {
		Rectangle bounds = configuration.getBounds();
		Insets insets = Toolkit.getDefaultToolkit().getScreenInsets(configuration);
		return new Rectangle(bounds.x + insets.left, bounds.y + insets.top,
				bounds.width - insets.left - insets.right, bounds.height - insets.top - insets.bottom);
	}

	// ---------- keeping the layout when the screens change ----------

	private synchronized void startScreenWatcher() {
		if (screenWatcher != null) {
			return;
		}
		screenWatcher = Executors.newSingleThreadScheduledExecutor(r -> {
			Thread t = new Thread(r, "Screen layout watcher");
			t.setDaemon(true);
			return t;
		});
		screenWatcher.scheduleWithFixedDelay(this::checkScreens, SCREEN_CHECK_PERIOD_SECONDS, SCREEN_CHECK_PERIOD_SECONDS,
				TimeUnit.SECONDS);
	}

	/**
	 * Lays the windows out again once the screens changed and settled (the same for two checks in a row: a screen being
	 * plugged in goes through several configurations).
	 */
	private void checkScreens() {
		try {
			String now = screensSignature();
			boolean settled = now.equals(lastSeen);
			lastSeen = now;
			if (settled && arrangedOn != null && !now.equals(arrangedOn)) {
				logger.info("The screens changed, arranging the windows again");
				if (!arrange()) {
					// The windows are gone: nothing to keep in place until they are opened again
					arrangedOn = now;
				}
			}
		} catch (Exception e) {
			logger.debug("Could not check the screens", e);
		}
	}

	private static String screensSignature() {
		GraphicsEnvironment env = GraphicsEnvironment.getLocalGraphicsEnvironment();
		Rectangle[] areas = Arrays.stream(env.getScreenDevices()).map(d -> workArea(d.getDefaultConfiguration()))
				.toArray(Rectangle[]::new);
		return env.getDefaultScreenDevice().getIDstring() + Arrays.toString(areas);
	}
}
