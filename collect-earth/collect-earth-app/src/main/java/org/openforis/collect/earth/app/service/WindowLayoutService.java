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
 * Lays out the imagery windows (Google Earth Web and the other imagery sources, see {@link ImageryBrowser}) so that the
 * imagery gets as much room as possible: the window of Google Earth Web, with the plots map in a panel of its page (see
 * GoogleEarthWebService), maximized on the largest screen, the main one when another is as large; the other sources
 * maximized in their own window on another screen. On a single screen their window covers Google Earth Web beside the
 * panel, which stays in sight: a click in it brings Google Earth Web back.
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
 * <p>The layout is kept: it is applied again whenever a browser for the imagery windows starts (the first time, or
 * after the user closed it), when one of its windows opens, when the user asks ("Open Collect Earth" of the tray icon),
 * and when screens are added, removed or resized (e.g. a laptop docked or undocked) while the windows are open. A new tab
 * needs nothing: the tabs share their window.</p>
 *
 * <p>Threads: every classic WebDriver call on the windows is made holding {@link #lock}, as the driver is not safe to
 * use from two threads at once (see {@link ImageryBrowser#window()}).</p>
 */
@Component
public class WindowLayoutService {

	/** What a check of a window found: see {@link #windowState}. */
	public enum WindowState { OPEN, CLOSED, NO_ANSWER }

	/** How the imagery window was placed last, so that bringing it forward can put it back so. */
	enum ImageryPlacement { NORMAL, MAXIMIZED }

	/**
	 * How a plan places the window of the other sources, when they have one ({@link ImageryWindow#OTHERS}): maximized on a
	 * screen of their own, and on a single screen beside the panel (NORMAL).
	 */
	static ImageryPlacement othersPlacement(Plan plan) {
		return plan.othersScreen == plan.imageryScreen ? ImageryPlacement.NORMAL : ImageryPlacement.MAXIMIZED;
	}

	/** Where the windows go: the screen of Google Earth Web's window, and the one of the other sources' window. */
	static final class Plan {
		final int imageryScreen;
		final int othersScreen;

		Plan(int imageryScreen, int othersScreen) {
			this.imageryScreen = imageryScreen;
			this.othersScreen = othersScreen;
		}

		@Override
		public String toString() {
			return "Google Earth Web on screen " + imageryScreen + ", other sources on screen " + othersScreen;
		}
	}

	/** The width the plots map's panel opens with (javascript_plots_map_panel.fmt). */
	private static final int DEFAULT_PANEL_WIDTH = 560;
	private static final String PANEL_WIDTH_SCRIPT = "var panel = document.querySelector('div[data-ce-panel]');"
			+ " return panel ? Math.round(panel.getBoundingClientRect().width) : 0;";
	/** A window this far from where it was asked to go (in px) is moved once more. */
	private static final int PLACEMENT_TOLERANCE = 2;
	private static final long SCREEN_CHECK_PERIOD_SECONDS = 2;

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

	private final Object lock = new Object();
	/** How long a check of a window waits for its browser: see {@link #isImageryWindowClosed()}. */
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
	private final WindowProbe imageryProbe = new WindowProbe("Imagery window check", PROBE_TIMEOUT);
	private ScheduledExecutorService screenWatcher;
	/** The screens the windows were last laid out on (see {@link #screensSignature}). */
	private volatile String arrangedOn;
	/** The screens at the previous check of the watcher. */
	private String lastSeen;
	/**
	 * Whether the window of the other sources is on a screen of its own, where it is in sight: picking one of them then
	 * only selects its tab, without bringing the window forward, which blinks (see {@link #bringImageryWindowForward}).
	 */
	private volatile boolean othersOnOwnScreen;
	/**
	 * How {@link #arrange(boolean)} placed each imagery window last; NORMAL until it does (headless)
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
	 * Whether the imagery browser should show Google Earth Web in a window of its own and the other sources in another,
	 * so that Google Earth Web stays in sight while the other sources are looked through: whenever there is a screen.
	 * Asked as the imagery browser starts (see {@link ImageryBrowser#separateWindowsWhen}).
	 */
	boolean wantsSeparateImageryWindows() {
		return !GraphicsEnvironment.isHeadless();
	}

	/** Lays out the windows that are open, where they are in the stack of windows (when one opens, when the screens change). */
	public boolean arrange() {
		return arrange(false);
	}

	/**
	 * As {@link #arrange()}, and brings the windows in front of the others: the user asked for them ("Open Collect Earth"
	 * of the tray icon). First opens Google Earth Web, with the plots map in its panel, if it is not open (it is reopened
	 * by itself too, see {@link PlotsMapKeeper}, but this does not wait for its next check): the windows are of no use
	 * closed, and asking for them back is what the user does when one is lost.
	 */
	public boolean arrangeAndBringForward() {
		if (!browserService.isClosing() && isImageryWindowClosed()) {
			logger.info("Arrange: Google Earth Web, with the plots map, is not open, opening it");
			browserService.openLeafletMap();
		}
		return arrange(true);
	}

	/**
	 * Starts the imagery browser again, with the plots map in Google Earth Web's panel, when it is open: a setting it
	 * takes at its start changed (the language, which Google Earth Web shows itself in). Not open, the next start takes
	 * the setting anyway.
	 */
	public void restartImageryBrowser() {
		if (imageryBrowser.classicDriver() == null || browserService.isClosing()) {
			return;
		}
		logger.info("Starting the imagery browser again for a setting it takes at its start");
		imageryBrowser.close();
		browserService.openLeafletMap();
		arrange(false);
	}

	/**
	 * Whether the window was found closed, and again {@link #CONFIRM_CLOSED_MILLIS} later: reopening a window that is in
	 * fact there reloads it (its browser is quit, and the form in the panel loses what was typed), so one odd answer of a
	 * browser is not enough. The keeper, which looks every 2 s, waits for two checks in a row in the
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
	 * Whether the window of this imagery browser is open: a {@code getWindowHandles()} to its browser, which is cheap (the
	 * browser answers it without the page, which may be busy). CLOSED also when the browser still runs without a window
	 * (macOS).
	 * <p>
	 * Not under {@link #lock}, unlike the other classic calls on the windows: a hung browser would hold it, and the
	 * layout, the imagery source buttons and "Arrange" with it, until Selenium gives up on the call (3 minutes). It goes
	 * through a {@link WindowProbe}, which waits for it {@link #PROBE_TIMEOUT} at most. Alongside a placement it is
	 * harmless: it reads the list of windows, it neither switches nor moves one, and the driver serves the two calls one
	 * after the other.
	 */
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
	 * runs. Asked outside {@link #lock}, through a {@link WindowProbe}, as {@link #imageryWindow}; and told outside it,
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
	 * the plots map in its panel, and lose what was typed in its form.
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
		if (GraphicsEnvironment.isHeadless()) {
			return false;
		}
		synchronized (lock) {
			if (imageryBrowser.classicDriver() == null) {
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
				Plan plan = plan(workAreas, primaryIndex);
				logger.info("Arranging the imagery windows: {} ({} screens)", plan, screens.length);
				othersOnOwnScreen = othersApart && plan.othersScreen != plan.imageryScreen;
				// The other sources first: the classic session of the imagery browser addresses one window at a time, and
				// the window of Google Earth Web, placed after, comes over theirs where they share a screen
				if (othersApart) {
					placeOthers(plan, workAreas, bringForward);
				}
				RemoteWebDriver imagery = imageryBrowser.window();
				if (imagery != null) {
					imageryPlacements.put(ImageryWindow.MAIN, ImageryPlacement.MAXIMIZED);
					maximizeOn(imagery, workAreas[plan.imageryScreen], bringForward);
				}
				arrangedOn = screensSignature();
				startScreenWatcher();
				if (othersApart) {
					browserService.markImageryWindows();
				}
				return true;
			} catch (Exception e) {
				logger.warn("Could not arrange the imagery windows", e);
				return false;
			}
		}
	}

	/**
	 * Places the window of the other sources: maximized on a screen of their own, else over the window of Google Earth Web
	 * beside the panel.
	 */
	private void placeOthers(Plan plan, Rectangle[] workAreas, boolean bringForward) {
		ImageryPlacement placement = othersPlacement(plan);
		// Measured before the window of the other sources is asked for: the classic session addresses one at a time
		int panel = placement == ImageryPlacement.NORMAL ? panelWidth() : 0;
		RemoteWebDriver others = imageryBrowser.window(ImageryWindow.OTHERS);
		if (others == null) {
			return;
		}
		imageryPlacements.put(ImageryWindow.OTHERS, placement);
		if (placement == ImageryPlacement.MAXIMIZED) {
			maximizeOn(others, workAreas[plan.othersScreen], bringForward);
			return;
		}
		Rectangle work = measureWorkArea(others, workAreas[plan.othersScreen]);
		int left = othersLeftOfPanel(panel, work.width);
		Insets border = invisibleBorders(others);
		if (bringForward) {
			bringForwardLocked(others);
		}
		placeExactly(others, withInvisibleBorders(
				new Rectangle(work.x + left, work.y, work.width - left, work.height), border));
	}

	/**
	 * How far from the left of the screen the window of the other sources starts on a single screen: at the right edge of the panel, which stays in sight, or where the panel opens when it is
	 * not there yet; always leaving the other sources half of the screen.
	 */
	static int othersLeftOfPanel(int panelWidth, int screenWidth) {
		int left = panelWidth > 0 ? panelWidth : DEFAULT_PANEL_WIDTH;
		return Math.min(left, screenWidth / 2);
	}

	/** The width of the plots map's panel in Google Earth Web's page (javascript_plots_map_panel.fmt), 0 if none. */
	private int panelWidth() {
		RemoteWebDriver earth = imageryBrowser.window();
		if (earth == null) {
			return 0;
		}
		try {
			Object width = earth.executeScript(PANEL_WIDTH_SCRIPT);
			return width instanceof Number ? ((Number) width).intValue() : 0;
		} catch (WebDriverException e) {
			logger.debug("Could not measure the plots map panel", e);
			return 0;
		}
	}

	@PreDestroy
	public void stopScreenWatcher() {
		imageryProbe.shutdown();
		if (screenWatcher != null) {
			screenWatcher.shutdownNow();
		}
	}

	// ---------- the plan (no windows involved: tested in WindowLayoutTest) ----------

	/**
	 * Where each window goes on these screens (work areas): Google Earth Web on the largest, the other sources on the
	 * largest of the others, or with Google Earth Web when there is no other.
	 */
	static Plan plan(Rectangle[] screens, int primary) {
		int earth = largestScreen(screens, primary);
		int others = largestOther(screens, earth);
		return new Plan(earth, others < 0 ? earth : others);
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

	/** Moves the window onto the screen and maximizes it there: the browser then fits it to that screen itself. */
	private void maximizeOn(RemoteWebDriver window, Rectangle screen, boolean bringForward) {
		if (window == null || (!bringForward && fills(window, screen))) {
			return;
		}
		Rectangle work = measureWorkArea(window, screen);
		if (bringForward) {
			bringForwardLocked(window);
		}
		WebDriver.Window w = window.manage().window();
		w.maximize();
		Point position = w.getPosition();
		Dimension size = w.getSize();
		// A maximized window overlaps the edges of the work area by its invisible borders: only being elsewhere matters
		if (!work.intersects(new Rectangle(position.x, position.y, size.width, size.height))) {
			logger.warn("The window was asked to fill the screen at {} but is at {} {}", work, position, size);
		}
	}

	/**
	 * Whether the window already fills the work area of that screen, as a maximized one does (overlapping its edges by
	 * its invisible borders): it is then left as it is. Placed all the same, it is first made small to find the screen it
	 * is on (see {@link #measureWorkArea}) and maximized again, which the user sees as the whole window shrinking and
	 * growing back, each time a window opens: Google Earth Web's, when the one of the other sources opens with the first
	 * plot.
	 */
	private boolean fills(RemoteWebDriver window, Rectangle screen) {
		try {
			Rectangle placed = rectangleOf(window);
			GraphicsConfiguration javaScreen = javaScreenAt(placed.x + placed.width / 2, placed.y + placed.height / 2);
			if (javaScreen == null || !workArea(javaScreen).equals(screen)) {
				return false;
			}
			Rectangle work = readWorkArea(window);
			return work != null && Math.abs(placed.x - work.x) <= MAX_WORK_AREA_CORRECTION
					&& Math.abs(placed.y - work.y) <= MAX_WORK_AREA_CORRECTION
					&& Math.abs(placed.width - work.width) <= 2 * MAX_WORK_AREA_CORRECTION
					&& Math.abs(placed.height - work.height) <= 2 * MAX_WORK_AREA_CORRECTION;
		} catch (WebDriverException e) {
			return false;
		}
	}

	/** Whether the window is minimized: Windows puts a minimized window at -32000, -32000. */
	private static boolean isMinimized(RemoteWebDriver window) {
		try {
			Point position = window.manage().window().getPosition();
			return position.x <= -30000 && position.y <= -30000;
		} catch (WebDriverException e) {
			return false;
		}
	}

	/**
	 * Puts the window inside the screen (in Java's coordinates, close enough to land on it), then asks the browser for
	 * the work area of the screen it is now on, in the browser's own coordinates. Falls back to Java's figures when the
	 * browser gives none.
	 */
	private Rectangle measureWorkArea(RemoteWebDriver window, Rectangle screen) {
		WebDriver.Window w = window.manage().window();
		// Setting the size first also brings a maximized window back to normal before it moves
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
	 * plots map's panel. The window is asked for holding {@link #lock}, see {@link ImageryBrowser#window()}.
	 */
	public void bringImageryWindowForward(ImagerySource source) {
		synchronized (lock) {
			ImageryWindow which = imageryBrowser.windowOf(source);
			RemoteWebDriver imagery = imageryBrowser.window(which);
			if (imagery == null) {
				return;
			}
			if (which == ImageryWindow.OTHERS && othersOnOwnScreen && !isMinimized(imagery)) {
				return; // in sight on its screen: the tab selected is enough
			}
			// Restored as a normal window, which would leave a maximized one covering its old place with its borders and
			// title bar showing: put back as the layout placed it (restored first, as maximizeOn does)
			bringForwardLocked(imagery);
			try {
				if (imageryPlacements.get(which) == ImageryPlacement.MAXIMIZED) {
					imagery.manage().window().maximize();
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
