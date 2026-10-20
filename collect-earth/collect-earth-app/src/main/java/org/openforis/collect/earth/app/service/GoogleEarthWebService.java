package org.openforis.collect.earth.app.service;

import java.awt.GraphicsConfiguration;
import java.awt.GraphicsDevice;
import java.awt.GraphicsEnvironment;
import java.awt.Insets;
import java.awt.Rectangle;
import java.awt.Toolkit;
import java.io.File;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import javax.annotation.PreDestroy;

import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openqa.selenium.Dimension;
import org.openqa.selenium.Point;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Drives the Google Earth Web window used as the imagery viewer when the plot viewer is
 * "Plots map + Google Earth Web". Google Earth Web has no API: the camera is moved through
 * the page URL and the plot outline is drawn by an injected script
 * (resources/javascript_google_earth_web.fmt).
 *
 * <ul>
 * <li>Requests are coalesced: while the window is busy only the most recent plot is kept,
 * so stepping quickly through plots never replays a backlog.</li>
 * <li>Once loaded, the window is moved to the next plot without reloading when Google Earth
 * Web supports it (detected at run time), otherwise with a single page load.</li>
 * <li>A watchdog re-draws the outline if the page was reloaded and notices a closed window.</li>
 * <li>The window keeps its own browser profile, so Google's cookie consent, sign-in and the
 * user's Google Earth Web settings survive restarts; while Google waits for the user (consent,
 * sign-in) the state is WAITING and the plot is shown as soon as Google Earth Web is reached.</li>
 * <li>The state, and where the camera looks, are reported to the plots map
 * (/googleEarthWeb/status); the map sends the neighbouring plots and their statuses
 * (/googleEarthWeb/context), drawn around the current plot.</li>
 * </ul>
 */
@Component
public class GoogleEarthWebService {

	public enum State { CLOSED, OPENING, MOVING, READY, WAITING, ERROR }

	private static final String OVERLAY_TEMPLATE = "resources/javascript_google_earth_web.fmt";
	private static final String OVERLAY_TAG = "__collectEarthGewOverlay";

	/** How long to wait for Google Earth Web to follow an in-page navigation. */
	private static final long IN_PAGE_NAVIGATION_TIMEOUT_MILLIS = 4000;
	/** Also how often the camera is read for the plots map, which follows it. */
	private static final long WATCHDOG_PERIOD_MILLIS = 500;
	/** The ground altitude learnt at one place is used for camera URLs up to this far away. */
	private static final double GROUND_ALTITUDE_RANGE_METERS = 50000;
	// Message codes for the plots map, which shows them translated (gew.msg.* in i18n.ts)
	private static final String MESSAGE_NO_BROWSER = "no_browser";
	private static final String MESSAGE_OUTLINE_FAILED = "outline_failed";
	private static final String MESSAGE_OPEN_FAILED = "open_failed";

	/** Information bar texts in the Collect Earth UI language (Messages*.properties). */
	private static final String[] LABEL_KEYS = { "plot", "hintTilted", "hintOutOfView", "hintUnavailable", "topDown",
			"topDownTooltip" };
	private static final String PROFILE_FOLDER = "browser_profiles" + File.separator + "google_earth_web";

	/** Camera URL, window size and whether the overlay is armed, in one round trip. */
	private static final String PAGE_STATE_SCRIPT = "return [location.href, window.innerWidth, window.innerHeight, !!window."
			+ OVERLAY_TAG + "];";
	private static final int MIN_MAP_WINDOW_WIDTH = 760;

	/**
	 * Pushes the plot URL onto the history and fires popstate, which Google Earth Web's
	 * router may follow by flying the camera. The previous plot's overlay is stopped first:
	 * it reads the camera from the URL and would draw the old plot at the new position.
	 */
	private static final String IN_PAGE_NAVIGATION_SCRIPT =
			"var o = window." + OVERLAY_TAG + "; if (o && o.stop) { o.stop(); }"
			+ "history.pushState(null, '', arguments[0]);"
			+ "window.dispatchEvent(new PopStateEvent('popstate', { state: null }));";

	/** The same, keeping the overlay: the plot does not change, only where the camera looks. */
	private static final String CAMERA_MOVE_SCRIPT = "history.pushState(null, '', arguments[0]);"
			+ "window.dispatchEvent(new PopStateEvent('popstate', { state: null }));";

	private final Logger logger = LoggerFactory.getLogger(GoogleEarthWebService.class);

	@Autowired
	private BrowserService browserService;

	@Autowired
	private GeolocalizeMapService geolocalizeMapService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private final Object lock = new Object();
	private final AtomicReference<SimplePlacemarkObject> pending = new AtomicReference<>();
	private volatile RemoteWebDriver driver;
	/** The plot currently shown (null: overview, or nothing yet). */
	private volatile SimplePlacemarkObject current;
	/** Whether Google Earth Web follows in-page navigation; null until tried once. */
	private volatile Boolean inPageNavigation;
	private volatile boolean windowsArranged;

	private volatile State state = State.CLOSED;
	private volatile String statePlotId;
	private volatile String stateMessage;
	/** Where the Google Earth Web camera looks (null when unknown or not top-down). */
	private volatile Map<String, Object> view;
	/** Neighbouring plots sent by the plots map for the plot {@link #contextPlotId}, as JSON. */
	private volatile String contextJson = "[]";
	private volatile String contextPlotId;
	/** Camera position requested by the plots map, latest only: {latitude, longitude, heightMeters}. */
	private final AtomicReference<double[]> pendingCamera = new AtomicReference<>();
	/** Counts the plots shown: a camera move asked for before a plot was shown is dropped. */
	private final AtomicLong showCount = new AtomicLong();
	/**
	 * Altitude of the ground where the camera looked last, from the URLs Google Earth Web writes
	 * ( it aims at the ground ), with where it was learnt. Null until then.
	 */
	private volatile Double groundAltitude;
	private volatile double[] groundAltitudePosition;
	/** Altitude of the last camera URL Collect Earth wrote. */
	private volatile Double writtenAltitude;

	private ScheduledExecutorService watchdog;

	// ---------- public API ----------

	/**
	 * Shows the plot in Google Earth Web (opening the window if needed). Returns at once if
	 * a newer request arrived while this one waited for the window.
	 */
	public void showPlot(SimplePlacemarkObject plot) {
		if (!localPropertiesService.isGoogleEarthWebViewer()) {
			return;
		}
		pending.set(plot);
		synchronized (lock) {
			SimplePlacemarkObject target = pending.getAndSet(null);
			if (target != null) {
				show(target, false);
			}
		}
	}

	/**
	 * Opens the window over the survey area before any plot is selected, so that the first
	 * plot appears quickly and the windows are laid out before work starts. Does nothing if
	 * the window is already open or a plot is being shown.
	 */
	public void openOverview(SimplePlacemarkObject center) {
		if (!localPropertiesService.isGoogleEarthWebViewer() || driver != null) {
			return;
		}
		synchronized (lock) {
			if (driver == null && pending.get() == null && current == null) {
				show(center, true);
			}
		}
	}

	/**
	 * Neighbouring plots (id, status, rings) to draw around {@code plotId}, sent by the plots
	 * map with each selection. Redraws at once if that plot is already shown.
	 */
	public void setContext(String plotId, String plotsJson) {
		contextPlotId = plotId;
		contextJson = plotsJson;
		SimplePlacemarkObject shown = current;
		if (state == State.READY && shown != null && plotId != null && plotId.equals(shown.getPlacemarkId())) {
			synchronized (lock) {
				if (driver != null && current == shown) {
					injectOverlay(shown);
				}
			}
		}
	}

	/**
	 * Moves the Google Earth Web camera to where the user moved the plots map: over that point, with
	 * the same height of ground in view. Only in-page ( a page load per map move would be unusable ),
	 * only while a plot or the overview is shown, and never over a plot shown since it was asked for.
	 * Requests are coalesced like the plots: the latest one wins.
	 */
	public void moveCamera(double latitude, double longitude, double heightMeters) {
		if (!localPropertiesService.isGoogleEarthWebViewer() || Boolean.FALSE.equals(inPageNavigation)) {
			return;
		}
		long requestedAfterShow = showCount.get();
		pendingCamera.set(new double[] { latitude, longitude, heightMeters });
		synchronized (lock) {
			double[] target = pendingCamera.getAndSet(null);
			if (target == null || showCount.get() != requestedAfterShow || state != State.READY || driver == null) {
				return;
			}
			try {
				String href = driver.getCurrentUrl();
				if (!GoogleEarthWebUrls.isGoogleEarthWeb(href)) {
					return;
				}
				// Aimed at the ground: the distance is then the height above it, as the map assumes
				Double current = GoogleEarthWebUrls.cameraAltitude(href);
				double altitude = Math.round(altitudeAt(target[0], target[1], current == null ? 0 : current));
				writtenAltitude = altitude;
				driver.executeScript(CAMERA_MOVE_SCRIPT,
						GoogleEarthWebUrls.movedCameraUrl(href, target[0], target[1], target[2], altitude));
			} catch (Exception e) {
				logger.debug("Could not move the Google Earth Web camera", e);
			}
		}
	}

	/** Places the plots map and Google Earth Web windows side by side (or on two screens). */
	public boolean arrangeWindows() {
		RemoteWebDriver gew = driver;
		if (gew == null) {
			return false;
		}
		try {
			GraphicsEnvironment env = GraphicsEnvironment.getLocalGraphicsEnvironment();
			if (GraphicsEnvironment.isHeadless()) {
				return false;
			}
			GraphicsDevice primary = env.getDefaultScreenDevice();
			Rectangle main = usableBounds(primary.getDefaultConfiguration());
			RemoteWebDriver map = browserService.getLeafletMapDriver();
			GraphicsDevice other = null;
			for (GraphicsDevice screen : env.getScreenDevices()) {
				if (!screen.equals(primary)) {
					other = screen;
					break;
				}
			}
			if (other != null) {
				// Two screens: plots map on the main one, Google Earth Web on the other
				place(map, main);
				place(gew, usableBounds(other.getDefaultConfiguration()));
			} else {
				// One screen: plots map (list + form) on the left, imagery gets the rest. The map
				// window needs ~760 px for the plot list, the form and some map; never over 60%.
				int mapWidth = (int) Math.min(Math.max(main.width * 0.45, MIN_MAP_WINDOW_WIDTH), main.width * 0.6);
				place(map, new Rectangle(main.x, main.y, mapWidth, main.height));
				place(gew, new Rectangle(main.x + mapWidth, main.y, main.width - mapWidth, main.height));
			}
			return true;
		} catch (Exception e) {
			logger.warn("Could not arrange the plots map and Google Earth Web windows", e);
			return false;
		}
	}

	/** State reported to the plots map. */
	public Map<String, Object> getStatus() {
		Map<String, Object> status = new LinkedHashMap<>();
		status.put("state", state.name());
		status.put("plotId", statePlotId);
		status.put("message", stateMessage);
		status.put("view", view);
		// Whether the camera can follow the plots map ( only without page loads )
		status.put("cameraSync", !Boolean.FALSE.equals(inPageNavigation));
		return status;
	}

	@PreDestroy
	public void stopWatchdog() {
		if (watchdog != null) {
			watchdog.shutdownNow();
		}
	}

	// ---------- showing a plot ----------

	private void show(SimplePlacemarkObject target, boolean overview) {
		String plotId = overview ? null : target.getPlacemarkId();
		if (!overview && isShowing(target)) {
			return;
		}
		showCount.incrementAndGet();
		String url = plotUrl(target, overview ? GoogleEarthWebUrls.OVERVIEW_DISTANCE : GoogleEarthWebUrls.PLOT_DISTANCE);
		try {
			boolean windowOpen = driver != null && browserService.isDriverWorking(driver);
			boolean moved = false;
			if (windowOpen && !Boolean.FALSE.equals(inPageNavigation) && isOnGoogleEarthWeb()) {
				setState(State.MOVING, plotId, null);
				moved = navigateInPage(url, target);
			}
			if (!moved) {
				setState(windowOpen ? State.MOVING : State.OPENING, plotId, null);
				RemoteWebDriver window = windowOpen ? driver : browserService.initBrowserWithProfile(profileFolder());
				driver = browserService.navigateTo(url, window, true, false);
				if (driver == null) {
					setState(State.ERROR, plotId, MESSAGE_NO_BROWSER);
					return;
				}
				if (!windowOpen) {
					startWatchdog();
					if (!windowsArranged) {
						windowsArranged = arrangeWindows();
					}
				}
			}
			current = overview ? null : target;
			if (!isOnGoogleEarthWeb()) {
				// Cookie consent, sign-in...: the watchdog shows the plot once the user is through
				setState(State.WAITING, plotId, null);
				return;
			}
			if (overview || injectOverlay(target)) {
				setState(State.READY, plotId, null);
			} else {
				setState(State.ERROR, plotId, MESSAGE_OUTLINE_FAILED);
			}
		} catch (Exception e) {
			logger.error("Problems showing the plot in Google Earth Web", e);
			setState(State.ERROR, plotId, MESSAGE_OPEN_FAILED);
		}
	}

	/** Already showing this plot in a working window (e.g. the same plot clicked twice). */
	private boolean isShowing(SimplePlacemarkObject target) {
		SimplePlacemarkObject shown = current;
		return shown != null && state == State.READY && target.getPlacemarkId() != null
				&& target.getPlacemarkId().equals(shown.getPlacemarkId())
				&& driver != null && browserService.isDriverWorking(driver) && isOnGoogleEarthWeb();
	}

	/**
	 * Moves the loaded page to the plot without reloading it (a reload costs several seconds
	 * of WebGL start-up and imagery loading). Google Earth Web rewrites the URL while its
	 * camera moves, so a URL that is still exactly the one pushed after a few seconds means
	 * it ignored the request: the caller then loads the page, and this is not tried again.
	 */
	private boolean navigateInPage(String url, SimplePlacemarkObject target) {
		try {
			driver.executeScript(IN_PAGE_NAVIGATION_SCRIPT, url);
			double latitude = Double.parseDouble(target.getCoord().getLatitude());
			double longitude = Double.parseDouble(target.getCoord().getLongitude());
			long end = System.currentTimeMillis() + IN_PAGE_NAVIGATION_TIMEOUT_MILLIS;
			while (System.currentTimeMillis() < end) {
				Thread.sleep(250);
				String href = driver.getCurrentUrl();
				if (!url.equals(href) && GoogleEarthWebUrls.isCameraAt(href, latitude, longitude)) {
					inPageNavigation = Boolean.TRUE;
					return true;
				}
			}
			if (inPageNavigation == null) {
				logger.info("Google Earth Web does not follow in-page navigation; plots will be loaded with a page load");
				inPageNavigation = Boolean.FALSE;
			}
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		} catch (Exception e) {
			logger.warn("In-page navigation in Google Earth Web failed", e);
		}
		return false;
	}

	private boolean isOnGoogleEarthWeb() {
		try {
			return GoogleEarthWebUrls.isGoogleEarthWeb(driver.getCurrentUrl());
		} catch (Exception e) {
			return false;
		}
	}

	/** Injects the plot outline and the information bar (see javascript_google_earth_web.fmt). */
	private boolean injectOverlay(SimplePlacemarkObject plot) {
		try {
			Map<String, Object> data = geolocalizeMapService.getPlacemarkData(plot);
			data.put("plotId", plot.getPlacemarkId() == null ? "" : plot.getPlacemarkId());
			data.put("plotUrl", plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE));
			data.put("inPageNavigation", String.valueOf(inPageNavigation));
			Map<String, String> labels = new LinkedHashMap<>();
			for (String key : LABEL_KEYS) {
				labels.put(key, Messages.getString("GoogleEarthWeb." + key));
			}
			data.put("labels", labels);
			data.put("neighboursJson", plot.getPlacemarkId() != null && plot.getPlacemarkId().equals(contextPlotId) ? contextJson : "[]");
			String script = browserService.processJavascriptTemplate(data, OVERLAY_TEMPLATE);
			if (script == null) {
				return false;
			}
			driver.executeScript(script);
			return true;
		} catch (Exception e) {
			logger.warn("Could not draw the plot outline in Google Earth Web", e);
			return false;
		}
	}

	// ---------- watchdog ----------

	private synchronized void startWatchdog() {
		if (watchdog != null) {
			return;
		}
		watchdog = Executors.newSingleThreadScheduledExecutor(r -> {
			Thread t = new Thread(r, "Google Earth Web watchdog");
			t.setDaemon(true);
			return t;
		});
		watchdog.scheduleWithFixedDelay(this::checkWindow, WATCHDOG_PERIOD_MILLIS, WATCHDOG_PERIOD_MILLIS, TimeUnit.MILLISECONDS);
	}

	/**
	 * Every 0.5 s while the window shows a plot or waits for the user: notices a window closed
	 * by the user (CLOSED, so the map offers to reopen it), tracks where the camera looks (the
	 * map follows it), shows the plot once Google lets the user through (WAITING -> READY) and
	 * re-draws the outline when the page lost it (F5, a page load from the information bar).
	 */
	private void checkWindow() {
		if ((state != State.READY && state != State.WAITING) || driver == null) {
			return;
		}
		synchronized (lock) {
			if ((state != State.READY && state != State.WAITING) || driver == null) {
				return;
			}
			if (!browserService.isDriverWorking(driver)) {
				driver = null;
				current = null;
				view = null;
				setState(State.CLOSED, null, null);
				return;
			}
			try {
				List<?> page = (List<?>) driver.executeScript(PAGE_STATE_SCRIPT);
				String href = String.valueOf(page.get(0));
				boolean armed = Boolean.TRUE.equals(page.get(3));
				SimplePlacemarkObject plot = current;
				String plotId = plot == null ? null : plot.getPlacemarkId();
				if (!GoogleEarthWebUrls.isGoogleEarthWeb(href)) {
					view = null;
					if (state == State.READY) {
						setState(State.WAITING, plotId, null);
					}
					return;
				}
				learnGroundAltitude(href);
				double[] camera = GoogleEarthWebUrls.cameraPosition(href);
				view = GoogleEarthWebUrls.cameraView(href, ((Number) page.get(1)).doubleValue(), ((Number) page.get(2)).doubleValue(),
						camera == null ? null : groundAltitudeNear(camera[0], camera[1]));
				if (state == State.WAITING) {
					// Through consent / sign-in: Google may have dropped the camera position
					if (plot != null && !GoogleEarthWebUrls.isCameraAt(href, Double.parseDouble(plot.getCoord().getLatitude()),
							Double.parseDouble(plot.getCoord().getLongitude()))) {
						driver = browserService.navigateTo(plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE), driver, true, false);
					}
					if (plot == null || injectOverlay(plot)) {
						setState(State.READY, plotId, null);
					}
				} else if (plot != null && !armed) {
					injectOverlay(plot);
				}
			} catch (Exception e) {
				logger.debug("Google Earth Web watchdog check failed", e);
			}
		}
	}

	// ---------- helpers ----------

	/**
	 * Camera URL of a plot, aimed at the ground: at the elevation of the plot, or else at the ground
	 * altitude learnt nearby. Aimed at sea level over hills the camera is hundreds of metres nearer
	 * to the ground than the distance says, and the plot fills the window.
	 */
	private String plotUrl(SimplePlacemarkObject plot, int distance) {
		String latitude = plot.getCoord().getLatitude();
		String longitude = plot.getCoord().getLongitude();
		int altitude = plot.getElevation();
		if (altitude <= 0) {
			try {
				altitude = (int) Math.round(altitudeAt(Double.parseDouble(latitude), Double.parseDouble(longitude), 0));
			} catch (NumberFormatException e) {
				altitude = 0;
			}
		}
		writtenAltitude = (double) altitude;
		return GoogleEarthWebUrls.cameraUrl(latitude, longitude, altitude, distance);
	}

	private double altitudeAt(double latitude, double longitude, double fallback) {
		Double ground = groundAltitudeNear(latitude, longitude);
		return ground == null ? fallback : ground;
	}

	private Double groundAltitudeNear(double latitude, double longitude) {
		Double ground = groundAltitude;
		double[] at = groundAltitudePosition;
		if (ground == null || at == null) {
			return null;
		}
		double north = (latitude - at[0]) * 111320;
		double east = (longitude - at[1]) * 111320 * Math.cos(Math.toRadians(latitude));
		return Math.hypot(north, east) <= GROUND_ALTITUDE_RANGE_METERS ? ground : null;
	}

	/**
	 * Once the user moved it, Google Earth Web aims the camera at the ground and writes its altitude.
	 * After a flight Collect Earth asked for it keeps the altitude it was given, which is not learnt:
	 * a guess would otherwise be carried from plot to plot.
	 */
	private void learnGroundAltitude(String href) {
		Double altitude = GoogleEarthWebUrls.cameraAltitude(href);
		double[] camera = GoogleEarthWebUrls.cameraPosition(href);
		Double written = writtenAltitude;
		if (altitude != null && camera != null && (written == null || Math.abs(altitude - written) > 0.5)) {
			groundAltitude = altitude;
			groundAltitudePosition = camera;
		}
	}

	private void setState(State newState, String plotId, String message) {
		state = newState;
		statePlotId = plotId;
		stateMessage = message;
	}

	/** Profile of the Google Earth Web window, in the Collect Earth data folder. */
	private static File profileFolder() {
		File folder = new File(FolderFinder.getCollectEarthDataFolder(), PROFILE_FOLDER);
		if (!folder.isDirectory() && !folder.mkdirs()) {
			LoggerFactory.getLogger(GoogleEarthWebService.class).warn("Could not create {}", folder);
		}
		return folder;
	}

	/** Screen bounds minus the task bar / dock. */
	private static Rectangle usableBounds(GraphicsConfiguration configuration) {
		Rectangle bounds = configuration.getBounds();
		Insets insets = Toolkit.getDefaultToolkit().getScreenInsets(configuration);
		return new Rectangle(bounds.x + insets.left, bounds.y + insets.top,
				bounds.width - insets.left - insets.right, bounds.height - insets.top - insets.bottom);
	}

	private static void place(RemoteWebDriver window, Rectangle rectangle) {
		if (window == null) {
			return;
		}
		window.manage().window().setPosition(new Point(rectangle.x, rectangle.y));
		window.manage().window().setSize(new Dimension(rectangle.width, rectangle.height));
	}
}
