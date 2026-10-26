package org.openforis.collect.earth.app.service;

import java.awt.GraphicsConfiguration;
import java.awt.GraphicsDevice;
import java.awt.GraphicsEnvironment;
import java.awt.Insets;
import java.awt.Rectangle;
import java.awt.Toolkit;
import java.net.ConnectException;
import java.net.SocketException;
import java.time.Duration;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import org.openforis.collect.earth.app.service.imagery.ImageryBrowser;
import org.openforis.collect.earth.app.service.imagery.ImagerySource;
import org.openforis.collect.earth.app.service.imagery.ImageryWindow;
import org.openqa.selenium.Dimension;
import org.openqa.selenium.NoSuchSessionException;
import org.openqa.selenium.NoSuchWindowException;
import org.openqa.selenium.Point;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebDriverException;
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
 * <li>Google Earth Web beside the form ("auto" with two screens or more): the form and Google Earth Web side by side on
 * the largest screen, the main one when another is as large, and the other sources maximized on another screen.</li>
 * <li>Plots map inside Google Earth Web: the window of Google Earth Web maximized on the largest screen, with the plots
 * map in a panel of its page (see GoogleEarthWebService), and the other sources maximized in their own window on
 * another screen, or under it on a single screen. The plots map window is minimized once Google Earth Web is open: it
 * is where the first plot is chosen.</li>
 * </ul>
 *
 * With Google Earth Web as the viewer, the imagery browser shows Google Earth Web in a window of its own and the other
 * sources in another (see {@link ImageryBrowser#separateWindowsWhen}): the layouts that have no screen of its own for
 * that window put it where Google Earth Web's is, under it; a source picked in the plots map brings it forward.
 *
 * Java only says which screen is which. Where a window goes on a screen is measured by the browser itself, in its own
 * coordinates (the work area of the screen the window is on), and every placement is read back and corrected once:
 * with screens of different scalings, Java's and the browser's coordinates do not agree, and the system may move or
 * resize a window on its own (snapping, minimum sizes).
 *
 * <p>On Windows, a window that is not maximized has invisible resize borders on its left, right and bottom (7 px at
 * 100 %), which the rectangle WebDriver sets and reads includes. Placed by that rectangle, the windows would stand 14 px
 * apart and 7 px above the task bar: each window's borders are measured by its browser (see
 * {@link #invisibleBorders(RemoteWebDriver)}) and its rectangle widened by them, so that what shows of it fills its
 * place.</p>
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

	enum Mode { SIDE_BY_SIDE, SEPARATE_SCREENS, IMAGERY_FULL_SCREEN, EARTH_BESIDE_FORM, PLOTS_MAP_IN_EARTH }

	/** What a check of a window found: see {@link #windowState}. */
	public enum WindowState { OPEN, CLOSED, NO_ANSWER }

	/** How the imagery window was placed last, so that bringing it forward can put it back so. */
	enum ImageryPlacement { NORMAL, MAXIMIZED, FULL_SCREEN }

	/**
	 * How a layout places the window of the other sources, when they have one ({@link ImageryWindow#OTHERS}): on a screen
	 * of its own as the imagery window would be, else over the window of Google Earth Web, placed as it is.
	 */
	static ImageryPlacement othersPlacement(Mode mode) {
		return mode == Mode.EARTH_BESIDE_FORM ? ImageryPlacement.MAXIMIZED : imageryPlacement(mode);
	}

	/** How a layout places the imagery window: see {@link #arrange(boolean)}. */
	static ImageryPlacement imageryPlacement(Mode mode) {
		switch (mode) {
		case SEPARATE_SCREENS:
		case PLOTS_MAP_IN_EARTH:
			return ImageryPlacement.MAXIMIZED;
		case IMAGERY_FULL_SCREEN:
			return ImageryPlacement.FULL_SCREEN;
		default:
			return ImageryPlacement.NORMAL;
		}
	}

	/**
	 * Where the windows go: the mode, and the screen of each window (the same one side by side). The imagery window is
	 * Google Earth Web's when the other sources have a window of their own, which goes to {@code othersScreen}.
	 */
	static final class Plan {
		final Mode mode;
		final int imageryScreen;
		final int formScreen;
		final int othersScreen;

		Plan(Mode mode, int imageryScreen, int formScreen) {
			this(mode, imageryScreen, formScreen, imageryScreen);
		}

		Plan(Mode mode, int imageryScreen, int formScreen, int othersScreen) {
			this.mode = mode;
			this.imageryScreen = imageryScreen;
			this.formScreen = formScreen;
			this.othersScreen = othersScreen;
		}

		@Override
		public String toString() {
			return mode + " imagery on screen " + imageryScreen + ", form on screen " + formScreen
					+ (othersScreen == imageryScreen ? "" : ", other sources on screen " + othersScreen);
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

	/**
	 * The work area (screen minus task bar / dock) of the screen the window is on, in the browser's coordinates, then the
	 * size of that screen.
	 */
	private static final String WORK_AREA_SCRIPT = "return [screen.availLeft || 0, screen.availTop || 0, screen.availWidth, screen.availHeight, screen.width, screen.height];";
	/**
	 * Most a work area of the browser is made larger to match Java's (see {@link #correctedWorkArea}): Firefox (158, on
	 * Windows 10) gives one 8 px shorter than the screen's; a larger difference is something else.
	 */
	private static final int MAX_WORK_AREA_CORRECTION = 16;
	/** What a window measures of its frame, see {@link #invisibleBorder(List)}. */
	private static final String FRAME_SCRIPT = "return [window.outerWidth, window.innerWidth, window.outerHeight, window.innerHeight,"
			+ " window.screenX, window.screenY, window.mozInnerScreenX, window.mozInnerScreenY, window.devicePixelRatio];";
	/** Larger than any invisible border (7 px at 100 %, about as many of the browser's px at other scalings). */
	private static final int MAX_INVISIBLE_BORDER = 16;
	private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows");

	private final Logger logger = LoggerFactory.getLogger(WindowLayoutService.class);

	@Autowired
	private BrowserService browserService;

	@Autowired
	private ImageryBrowser imageryBrowser;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private PlotImageryService plotImageryService;

	private final Object lock = new Object();
	/** How long a check of a window waits for its browser: see {@link #plotsMapWindow()}. */
	private static final Duration PROBE_TIMEOUT = Duration.ofSeconds(5);
	/** How long "Arrange" waits to look again at a window found closed: see {@link #closedTwice}. */
	private static final long CONFIRM_CLOSED_MILLIS = 500;
	/**
	 * What the drivers say, in lower case, when the browser or its window is gone in a way that has no exception of its
	 * own: chromedriver and msedgedriver "chrome not reachable" / "msedge not reachable", "not connected to DevTools",
	 * "session deleted because of page crash" / "...as the browser has closed the connection", "web view not found";
	 * geckodriver "Failed to decode response from marionette", "Tried to run command without establishing a connection".
	 * Not "disconnected" alone, which chromedriver also says when the user opens the developer tools ("disconnected:
	 * received Inspector.detached event"), nor what a busy page gives ("unable to receive message from renderer",
	 * "cannot determine loading status"): the window is there.
	 */
	private static final List<String> WINDOW_GONE = Arrays.asList("not reachable", "not connected to devtools",
			"session deleted", "browser has closed the connection", "web view not found",
			"failed to decode response from marionette", "tried to run command without establishing a connection");
	private final WindowProbe plotsMapProbe = new WindowProbe("Plots map window check", PROBE_TIMEOUT);
	private final WindowProbe imageryProbe = new WindowProbe("Imagery window check", PROBE_TIMEOUT);
	private ScheduledExecutorService screenWatcher;
	/** The screens the windows were last laid out on (see {@link #screensSignature}). */
	private volatile String arrangedOn;
	/** The screens at the previous check of the watcher. */
	private String lastSeen;
	/**
	 * Side by side, and Google Earth Web beside the form: the work area the windows share, in the browser's coordinates;
	 * null in the other layouts.
	 */
	private volatile Rectangle sideBySideWorkArea;
	/** Whether the window of the other sources is over the one of Google Earth Web, and follows the form with it. */
	private volatile boolean othersFollowForm;
	/**
	 * How {@link #arrange(boolean)} placed each imagery window last; NORMAL until it does (headless, the classic viewer)
	 * and again for a new browser, which the layout of its start sets anew. Guarded by {@link #lock}.
	 */
	private final Map<ImageryWindow, ImageryPlacement> imageryPlacements = new EnumMap<>(ImageryWindow.class);

	/**
	 * Lays out every new imagery window. Not on the thread that tells of it, which also tells the imagery services
	 * that a tab was shown: placing the windows takes a few seconds of WebDriver calls.
	 */
	@PostConstruct
	void layOutNewImageryWindows() {
		imageryBrowser.separateWindowsWhen(this::wantsSeparateImageryWindows);
		imageryBrowser.onBrowserStarted(() -> {
			synchronized (lock) {
				imageryPlacements.clear();
			}
			arrangeInBackground();
		});
		imageryBrowser.onWindowOpened(this::arrangeInBackground);
	}

	private void arrangeInBackground() {
		Thread thread = new Thread(this::arrange, "Imagery window layout");
		thread.setDaemon(true);
		thread.start();
	}

	/**
	 * Whether the imagery browser should show Google Earth Web in a window of its own and the other sources in another:
	 * always with Google Earth Web as the viewer, whatever the layout, so that Google Earth Web stays in sight while the
	 * other sources are looked through. The layout puts the other sources on a screen of their own where it has one for
	 * them ("auto" with two screens, "plots map inside Google Earth Web"), else where Google Earth Web is, under it.
	 * Asked as the imagery browser starts (see {@link ImageryBrowser#separateWindowsWhen}).
	 */
	boolean wantsSeparateImageryWindows() {
		return localPropertiesService.isGoogleEarthWebViewer() && !GraphicsEnvironment.isHeadless();
	}

	/**
	 * Lays out the windows that are open, where they are in the stack of windows (when one opens, when the screens
	 * change). Does nothing unless the plots map is the plot viewer: the classic viewer leaves the windows where they
	 * open.
	 */
	public boolean arrange() {
		return arrange(false);
	}

	/**
	 * As {@link #arrange()}, and brings the windows in front of the others: the user asked for them ("Arrange" in the
	 * main window and in the plots map). First opens again the windows the user closed: the plots map, which holds the
	 * form (it is reopened by itself too, see {@link PlotsMapKeeper}, but this does not wait for its next check), and
	 * the imagery window, on the plot shown last (see {@link PlotImageryService#reopenImagery()}). The windows are of no
	 * use closed, and asking for them back is what the user does when one is lost.
	 */
	public boolean arrangeAndBringForward() {
		if (localPropertiesService.isPlotsMapViewer() && !browserService.isClosing()) {
			reopenClosedWindows();
			separateWindowsAsWanted();
		}
		return arrange(true);
	}

	/**
	 * Starts the imagery browser again when its windows are not as the layout wants them now: the user chose another
	 * layout, or the screens changed since it started (tabs cannot move from one window to another). Only when the user
	 * asks for the layout: the pages of the imagery are loaded again, which a screen plugged in should not do unasked.
	 */
	private void separateWindowsAsWanted() {
		if (imageryBrowser.windowsAsWanted()) {
			return;
		}
		logger.info("Arrange: the imagery windows are not as the window layout wants them, starting the browser again");
		imageryBrowser.close();
		plotImageryService.reopenImagery();
	}

	private void reopenClosedWindows() {
		// Only a window that was open once: before that, there is nothing to open again
		if (browserService.getLeafletMapDriver() != null && closedTwice(this::plotsMapWindow)) {
			logger.info("Arrange: the plots map window was closed, opening it again");
			browserService.openLeafletMap(plotImageryService.getSelectedPlotId());
		}
		if (browserService.plotsMapInGoogleEarthWeb() && imageryBrowser.classicDriver() == null) {
			// The plots map is in Google Earth Web's window, which is not open: opened in place of the plots map window
			logger.info("Arrange: Google Earth Web, with the plots map, is not open, opening it");
			browserService.openLeafletMap(plotImageryService.getSelectedPlotId());
		} else if (isImageryWindowClosed() && plotImageryService.reopenImagery()) {
			logger.info("Arrange: the imagery window was closed, opening it again");
		}
	}

	/**
	 * Whether the window was found closed, and again {@link #CONFIRM_CLOSED_MILLIS} later: reopening a window that is in
	 * fact there reloads it (the plots map: its form loses what was typed; the imagery window: its browser is quit), so
	 * one odd answer of a browser is not enough. The keeper, which looks every 2 s, waits for two checks in a row in the
	 * same way (see {@link PlotsMapReopening#foundClosed()}).
	 */
	private boolean closedTwice(Supplier<WindowState> check) {
		if (check.get() != WindowState.CLOSED) {
			return false;
		}
		try {
			Thread.sleep(CONFIRM_CLOSED_MILLIS);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			return false;
		}
		return check.get() == WindowState.CLOSED;
	}

	/**
	 * Whether the plots map window is open: a {@code getWindowHandles()} to its browser, which is cheap (the browser
	 * answers it without the page, which may be busy). CLOSED also when it was never opened, and when the browser still
	 * runs without a window (macOS).
	 * <p>
	 * Not under {@link #lock}, unlike the other classic calls on the windows: a hung browser would hold it, and the
	 * layout, the imagery source buttons and "Arrange" with it, until Selenium gives up on the call (3 minutes). It goes
	 * through a {@link WindowProbe}, which waits for it {@link #PROBE_TIMEOUT} at most. Alongside a placement it is
	 * harmless: it reads the list of windows, it neither switches nor moves one, and the driver serves the two calls one
	 * after the other.
	 */
	public WindowState plotsMapWindow() {
		RemoteWebDriver map = browserService.getLeafletMapDriver();
		if (map == null) {
			return WindowState.CLOSED;
		}
		return plotsMapProbe.check(() -> windowState(map));
	}

	/** The window of this imagery browser, as {@link #plotsMapWindow()}. */
	private WindowState imageryWindow(RemoteWebDriver imagery) {
		return imageryProbe.check(() -> windowState(imagery));
	}

	/**
	 * Whether the imagery window was open and the user closed it. Closing it whole tells the imagery browser nothing (see
	 * {@link ImageryBrowser#isOpen}), so its window is asked, with the session as it is
	 * ({@link ImageryBrowser#classicDriver()}): {@code getWindowHandles()} needs no current tab, which
	 * {@link ImageryBrowser#window()} may not have just after the tab of the window commands closed. Found closed, the
	 * imagery browser is told, and quits it: the next command starts a new browser at once, which opens the tabs in
	 * their order, instead of taking the closed one for alive until a load finds it gone. Closed too when no browser
	 * runs. Asked outside {@link #lock}, through a {@link WindowProbe}, as {@link #plotsMapWindow()}; and told outside it,
	 * as quitting the browser may take seconds. The session is taken without the lock too: a hung placement holds it,
	 * and "Arrange" would wait it out here, which is what the probe is for. Taking it is two field reads, and asking for
	 * its windows switches no tab, unlike {@link ImageryBrowser#window()}, which needs the lock.
	 */
	private boolean isImageryWindowClosed() {
		RemoteWebDriver imagery = imageryBrowser.classicDriver();
		if (imagery == null) {
			return true;
		}
		// The same browser both times: one started meanwhile is not taken for closed
		if (!closedTwice(() -> imageryWindow(imagery))) {
			return false;
		}
		// Only that browser: windowClosed leaves alone one started since
		imageryBrowser.windowClosed(imagery);
		return true;
	}

	/**
	 * What the browser says of its window. CLOSED only for what means that it is gone (see {@link #meansClosed}), or a
	 * browser without a window; any other failure is NO_ANSWER: reopening a window that is in fact there would reload
	 * the plots map in it, and lose what was typed in its form.
	 */
	static WindowState windowState(RemoteWebDriver driver) {
		try {
			return driver.getWindowHandles().isEmpty() ? WindowState.CLOSED : WindowState.OPEN;
		} catch (WebDriverException e) {
			return meansClosed(e) ? WindowState.CLOSED : WindowState.NO_ANSWER;
		}
	}

	/**
	 * Whether a failed call to a browser means that its window or session is gone: the user closed the window (the
	 * browser ended with it, or has no such window any more), or the driver is gone and refuses or drops the connection.
	 * Read through the causes, as Selenium wraps them.
	 */
	static boolean meansClosed(Throwable failure) {
		for (Throwable t = failure; t != null; t = t.getCause()) {
			if (t instanceof NoSuchSessionException || t instanceof NoSuchWindowException || t instanceof ConnectException) {
				return true;
			}
			String message = t.getMessage() == null ? null : t.getMessage().toLowerCase(Locale.ROOT);
			if (message == null) {
				continue;
			}
			if (t instanceof SocketException
					&& (message.contains("connection reset") || message.contains("connection refused"))) {
				return true;
			}
			for (String gone : WINDOW_GONE) {
				if (message.contains(gone)) {
					return true;
				}
			}
		}
		return false;
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
			if (map == null && imageryBrowser.classicDriver() == null) {
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
				boolean othersApart = imageryBrowser.hasOthersWindow();
				Plan plan = plan(localPropertiesService.getWindowLayout(), workAreas, primaryIndex, othersApart);
				logger.info("Arranging the plots map and imagery windows: {} ({} screens)", plan, screens.length);
				sideBySideWorkArea = null;
				othersFollowForm = false;
				// The other sources first: the classic session of the imagery browser addresses one window at a time, and
				// the window of Google Earth Web, placed after, comes over theirs where they share a place
				if (othersApart) {
					placeOthers(plan, workAreas, bringForward);
				}
				RemoteWebDriver imagery = imageryBrowser.window();
				if (imagery != null) {
					imageryPlacements.put(ImageryWindow.MAIN, imageryPlacement(plan.mode));
				}
				switch (plan.mode) {
				case SIDE_BY_SIDE:
				case EARTH_BESIDE_FORM:
					sideBySideWorkArea = placeSideBySide(map, imagery, workAreas[plan.imageryScreen], bringForward);
					break;
				case PLOTS_MAP_IN_EARTH:
					if (imagery == null) {
						// Google Earth Web not open yet: the first plot is chosen in the plots map
						maximizeOn(map, workAreas[plan.formScreen], false, bringForward);
					} else {
						minimize(map);
						maximizeOn(imagery, workAreas[plan.imageryScreen], false, bringForward);
					}
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
				if (othersApart) {
					browserService.markImageryWindows();
				}
				return true;
			} catch (Exception e) {
				logger.warn("Could not arrange the plots map and imagery windows", e);
				return false;
			}
		}
	}

	/**
	 * Places the window of the other sources: maximized on a screen of their own, else as the window of Google Earth Web
	 * is, which then covers it (one screen, or a layout chosen since the browser started). Side by side it then follows
	 * the form along with the window of Google Earth Web.
	 */
	private void placeOthers(Plan plan, Rectangle[] workAreas, boolean bringForward) {
		RemoteWebDriver others = imageryBrowser.window(ImageryWindow.OTHERS);
		if (others == null) {
			return;
		}
		ImageryPlacement placement = othersPlacement(plan.mode);
		imageryPlacements.put(ImageryWindow.OTHERS, placement);
		if (placement != ImageryPlacement.NORMAL) {
			maximizeOn(others, workAreas[plan.othersScreen], placement == ImageryPlacement.FULL_SCREEN, bringForward);
			return;
		}
		Rectangle work = measureWorkArea(others, workAreas[plan.othersScreen]);
		int formWidth = formWindowWidth(work.width);
		Insets border = invisibleBorders(others);
		if (bringForward) {
			bringForwardLocked(others);
		}
		placeExactly(others, withInvisibleBorders(
				new Rectangle(work.x + formWidth, work.y, work.width - formWidth, work.height), border));
		othersFollowForm = true;
	}

	/**
	 * Side by side, after the user resized or moved the plots map window: the imagery window takes the room left beside it
	 * (the wider side), the whole height of the screen; so does the window of the other sources when it is under it.
	 * Nothing happens in the other layouts, when the plots map left the screen they share, or when the room left is too
	 * narrow for the imagery (e.g. the plots map was maximized).
	 */
	public void followFormWindow() {
		if (sideBySideWorkArea == null) {
			return;
		}
		synchronized (lock) {
			Rectangle work = sideBySideWorkArea;
			RemoteWebDriver map = browserService.getLeafletMapDriver();
			if (work == null || map == null) {
				return;
			}
			try {
				Rectangle form = visiblePart(rectangleOf(map), invisibleBorders(map));
				Rectangle room = besideForm(work, form);
				if (room == null) {
					logger.debug("No room for the imagery window beside the plots map at {}", form);
					return;
				}
				// Google Earth Web last, as arrange places them
				if (othersFollowForm) {
					moveTo(imageryBrowser.window(ImageryWindow.OTHERS), room);
				}
				moveTo(imageryBrowser.window(), room);
			} catch (Exception e) {
				logger.debug("The imagery window could not follow the plots map window", e);
			}
		}
	}

	/** Puts what shows of the window at {@code room}, unless it is there. */
	private void moveTo(RemoteWebDriver window, Rectangle room) {
		if (window == null) {
			return;
		}
		Rectangle target = withInvisibleBorders(room, invisibleBorders(window));
		if (!isAt(rectangleOf(window), target)) {
			placeExactly(window, target);
		}
	}

	@PreDestroy
	public void stopScreenWatcher() {
		plotsMapProbe.shutdown();
		imageryProbe.shutdown();
		if (screenWatcher != null) {
			screenWatcher.shutdownNow();
		}
	}

	// ---------- the plan (no windows involved: tested in WindowLayoutTest) ----------

	/** Where each window goes for this layout on these screens (work areas), with the imagery in one window. */
	static Plan plan(String layout, Rectangle[] screens, int primary) {
		return plan(layout, screens, primary, false);
	}

	/**
	 * Where each window goes for this layout on these screens (work areas).
	 *
	 * @param othersApart whether the other sources have a window of their own, apart from the one of Google Earth Web
	 */
	static Plan plan(String layout, Rectangle[] screens, int primary, boolean othersApart) {
		if (LocalPropertiesService.WINDOW_LAYOUT_PLOTS_MAP_IN_EARTH.equals(layout)) {
			int earth = largestScreen(screens, primary);
			int others = largestOther(screens, earth);
			return new Plan(Mode.PLOTS_MAP_IN_EARTH, earth, earth, others < 0 ? earth : others);
		}
		if (othersApart && screens.length >= 2 && LocalPropertiesService.WINDOW_LAYOUT_AUTO.equals(layout)) {
			int earth = largestScreen(screens, primary);
			return new Plan(Mode.EARTH_BESIDE_FORM, earth, earth, largestOther(screens, earth));
		}
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

	/** The largest screen; the main one when another is as large (it has the task bar and Collect Earth). */
	static int largestScreen(Rectangle[] screens, int primary) {
		int largest = primary;
		for (int i = 0; i < screens.length; i++) {
			if (area(screens[i]) > area(screens[largest])) {
				largest = i;
			}
		}
		return largest;
	}

	/** The largest screen but {@code except}, or -1 when there is no other. */
	static int largestOther(Rectangle[] screens, int except) {
		int largest = -1;
		for (int i = 0; i < screens.length; i++) {
			if (i != except && (largest < 0 || area(screens[i]) > area(screens[largest]))) {
				largest = i;
			}
		}
		return largest;
	}

	/** Width of the plots map window next to the imagery window on a screen this wide (never over half of it). */
	static int formWindowWidth(int screenWidth) {
		int width = (int) Math.round(screenWidth * FORM_WINDOW_SHARE);
		return Math.min(Math.max(width, MIN_FORM_WINDOW_WIDTH), Math.min(MAX_FORM_WINDOW_WIDTH, screenWidth / 2));
	}

	/**
	 * The room left in the work area beside the form window (what shows of it, see {@link #visiblePart}), on its wider
	 * side, the whole height; null when the form is mostly off that screen or the room is narrower than
	 * {@link #MIN_IMAGERY_WIDTH}.
	 */
	static Rectangle besideForm(Rectangle work, Rectangle form) {
		// A maximized window overhangs the work area: only being mostly elsewhere means it left the screen
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

	/**
	 * The rectangle to give a window so that what shows of it is {@code visible}: widened by its invisible borders (left,
	 * right and bottom on Windows; the top edge of the title bar shows).
	 */
	static Rectangle withInvisibleBorders(Rectangle visible, Insets border) {
		return new Rectangle(visible.x - border.left, visible.y - border.top, visible.width + border.left + border.right,
				visible.height + border.top + border.bottom);
	}

	/** What shows of a window at this rectangle with these invisible borders: the reverse of {@link #withInvisibleBorders}. */
	static Rectangle visiblePart(Rectangle window, Insets border) {
		return new Rectangle(window.x + border.left, window.y + border.top, window.width - border.left - border.right,
				window.height - border.top - border.bottom);
	}

	/**
	 * The invisible border of a window that is not maximized (each of left, right and bottom: Windows makes them alike),
	 * in the browser's px, from what {@link #FRAME_SCRIPT} measured. Outer minus inner width, halved, is the border of a
	 * side plus the frame that shows, 1 px of the screen; Firefox also says where the page starts on the screen
	 * (mozInnerScreenX/Y), which gives the left border and the bottom one each by itself. The smallest of these is taken:
	 * a side bar or docked developer tools only make one of them larger. 0 when it cannot be told: nothing measured, a
	 * page zoom (the inner size is then in other px), or a figure larger than any border.
	 */
	static int invisibleBorder(List<?> measured) {
		double outerWidth = numberAt(measured, 0);
		double innerWidth = numberAt(measured, 1);
		double outerHeight = numberAt(measured, 2);
		double innerHeight = numberAt(measured, 3);
		double screenX = numberAt(measured, 4);
		double screenY = numberAt(measured, 5);
		double pageX = numberAt(measured, 6);
		double pageY = numberAt(measured, 7);
		double pixelRatio = numberAt(measured, 8);
		double border = (outerWidth - innerWidth) / 2;
		if (!Double.isNaN(pageX) && !Double.isNaN(screenX)) {
			border = Math.min(border, pageX - screenX);
		}
		if (!Double.isNaN(pageY) && !Double.isNaN(screenY)) {
			border = Math.min(border, outerHeight - innerHeight - (pageY - screenY));
		}
		if (Double.isNaN(border) || border > MAX_INVISIBLE_BORDER) {
			return 0;
		}
		// Less the frame that shows: 1 px of the screen
		double shown = pixelRatio > 0 ? 1 / pixelRatio : 1;
		return (int) Math.max(0, Math.round(border - shown));
	}

	/**
	 * The browser's work area, as large as Java's when Java's is a little larger: Firefox gives one 8 px short of the
	 * task bar. Only when the browser and Java agree on the size of the screen (the browser's px may be Java's scaled:
	 * Java's work area is then scaled alike), and by {@link #MAX_WORK_AREA_CORRECTION} at most. A side is corrected only
	 * when the browser's work area starts where Java's does on that axis: with a task bar on the top or the left, one
	 * that starts elsewhere would otherwise be made to reach past the screen.
	 *
	 * @param work         the work area the browser gives
	 * @param screen       the size of the screen the browser gives
	 * @param javaBounds   the bounds of that screen in Java
	 * @param javaWorkArea its work area in Java
	 */
	static Rectangle correctedWorkArea(Rectangle work, java.awt.Dimension screen, Rectangle javaBounds,
			Rectangle javaWorkArea) {
		if (screen.width <= 0 || screen.height <= 0 || javaBounds.width <= 0 || javaBounds.height <= 0) {
			return work;
		}
		double scale = (double) screen.width / javaBounds.width;
		if (Math.abs(javaBounds.height * scale - screen.height) > 1) {
			return work;
		}
		int width = (int) Math.round(javaWorkArea.width * scale);
		int height = (int) Math.round(javaWorkArea.height * scale);
		// Where Java's work area starts, in the browser's px (on a screen that is not the main one, scaled, the browser's
		// coordinates may not be Java's scaled: then they do not agree, and nothing is corrected)
		boolean sameLeft = Math.abs(work.x - Math.round(javaWorkArea.x * scale)) <= 1;
		boolean sameTop = Math.abs(work.y - Math.round(javaWorkArea.y * scale)) <= 1;
		Rectangle corrected = new Rectangle(work);
		if (sameLeft && width > work.width && width - work.width <= MAX_WORK_AREA_CORRECTION) {
			corrected.width = width;
		}
		if (sameTop && height > work.height && height - work.height <= MAX_WORK_AREA_CORRECTION) {
			corrected.height = height;
		}
		return corrected;
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
			// Measured as it will be placed: not maximized (measureWorkArea made it a normal window)
			Insets border = invisibleBorders(map);
			if (bringForward) {
				bringForwardLocked(map);
			}
			placeExactly(map, withInvisibleBorders(new Rectangle(work.x, work.y, formWidth, work.height), border));
		}
		if (imagery != null) {
			Rectangle imageryWork = imagery == measuring ? work : measureWorkArea(imagery, screen);
			Insets border = invisibleBorders(imagery);
			if (bringForward) {
				bringForwardLocked(imagery);
			}
			placeExactly(imagery, withInvisibleBorders(new Rectangle(imageryWork.x + formWidth, imageryWork.y,
					imageryWork.width - formWidth, imageryWork.height), border));
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

	/** Minimizes the window, if there is one: its page goes on (the plots map, which keeps the form's state). */
	private void minimize(RemoteWebDriver window) {
		if (window == null) {
			return;
		}
		try {
			window.manage().window().minimize();
		} catch (WebDriverException e) {
			logger.debug("Could not minimize the window", e);
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
			GraphicsConfiguration javaScreen = javaScreenAt(centerX, centerY);
			if (!work.contains(centerX, centerY) && javaScreen != null) {
				Rectangle screen = workArea(javaScreen);
				logger.debug("The browser gave the work area {} away from its window at {}: on the screen at {}", work,
						placed, screen);
				work.setLocation(screen.x, screen.y);
			}
			if (javaScreen != null && area.size() >= 6) {
				Rectangle corrected = correctedWorkArea(work, new java.awt.Dimension(intAt(area, 4), intAt(area, 5)),
						javaScreen.getBounds(), workArea(javaScreen));
				if (!corrected.equals(work)) {
					logger.debug("The browser gave the work area {}, Java {}: taken as {}", work, workArea(javaScreen),
							corrected);
				}
				work = corrected;
			}
			return work;
		} catch (Exception e) {
			logger.debug("The browser did not say which screen it is on", e);
			return null;
		}
	}

	/** The screen, as Java sees it, holding this point; null when none does. */
	private static GraphicsConfiguration javaScreenAt(int x, int y) {
		for (GraphicsDevice screen : GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices()) {
			GraphicsConfiguration configuration = screen.getDefaultConfiguration();
			if (configuration.getBounds().contains(x, y)) {
				return configuration;
			}
		}
		return null;
	}

	/**
	 * The invisible borders of the window as it is now (see {@link #invisibleBorder(List)}): none but on Windows, and
	 * none when the browser does not say. That is 0 too when the window cannot be asked (its tab was closed, its page is
	 * busy or being replaced): the window is then placed as before the borders were measured, 7 px off at 100 %. Under
	 * a page zoom in Firefox the measure comes out in the page's px, about 7 / zoom of them, and the window is placed a
	 * few px off the same way.
	 */
	private Insets invisibleBorders(RemoteWebDriver window) {
		if (!WINDOWS) {
			return new Insets(0, 0, 0, 0);
		}
		try {
			int border = invisibleBorder((List<?>) window.executeScript(FRAME_SCRIPT));
			return new Insets(0, border, border, border);
		} catch (Exception e) {
			logger.debug("The browser did not measure its window", e);
			return new Insets(0, 0, 0, 0);
		}
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
	 * Brings the imagery window of the source in front of the others, if it is open: the user picked the source in the
	 * plots map, which is in front then. The window is asked for holding {@link #lock}, see {@link ImageryBrowser#window()}.
	 */
	public void bringImageryWindowForward(ImagerySource source) {
		synchronized (lock) {
			ImageryWindow which = imageryBrowser.windowOf(source);
			RemoteWebDriver imagery = imageryBrowser.window(which);
			if (imagery == null) {
				return;
			}
			// Restored as a normal window, which would leave a maximized or full-screen one covering its old place with
			// its borders and title bar showing: put back as the layout placed it (restored first, as maximizeOn does)
			bringForwardLocked(imagery);
			ImageryPlacement placement = imageryPlacements.getOrDefault(which, ImageryPlacement.NORMAL);
			try {
				if (placement == ImageryPlacement.MAXIMIZED) {
					imagery.manage().window().maximize();
				} else if (placement == ImageryPlacement.FULL_SCREEN) {
					imagery.manage().window().fullscreen();
				}
			} catch (Exception e) {
				logger.debug("Could not put the imagery window back as it was placed", e);
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

	private static double numberAt(List<?> values, int index) {
		Object value = values != null && index < values.size() ? values.get(index) : null;
		return value instanceof Number ? ((Number) value).doubleValue() : Double.NaN;
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
