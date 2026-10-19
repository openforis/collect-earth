package org.openforis.collect.earth.app.service;

import java.awt.GraphicsConfiguration;
import java.awt.GraphicsDevice;
import java.awt.GraphicsEnvironment;
import java.awt.Insets;
import java.awt.Rectangle;
import java.awt.Toolkit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import javax.annotation.PreDestroy;

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
 * <li>The state is reported to the plots map (/googleEarthWeb/status).</li>
 * </ul>
 */
@Component
public class GoogleEarthWebService {

	public enum State { CLOSED, OPENING, MOVING, READY, ERROR }

	private static final String OVERLAY_TEMPLATE = "resources/javascript_google_earth_web.fmt";
	private static final String OVERLAY_TAG = "__collectEarthGewOverlay";

	/** How long to wait for Google Earth Web to follow an in-page navigation. */
	private static final long IN_PAGE_NAVIGATION_TIMEOUT_MILLIS = 4000;
	private static final long WATCHDOG_PERIOD_SECONDS = 3;
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
		String url = GoogleEarthWebUrls.cameraUrl(target.getCoord().getLatitude(), target.getCoord().getLongitude(),
				target.getElevation(), overview ? GoogleEarthWebUrls.OVERVIEW_DISTANCE : GoogleEarthWebUrls.PLOT_DISTANCE);
		try {
			boolean windowOpen = driver != null && browserService.isDriverWorking(driver);
			boolean moved = false;
			if (windowOpen && !Boolean.FALSE.equals(inPageNavigation) && isOnGoogleEarthWeb()) {
				setState(State.MOVING, plotId, null);
				moved = navigateInPage(url, target);
			}
			if (!moved) {
				setState(windowOpen ? State.MOVING : State.OPENING, plotId, null);
				driver = browserService.navigateTo(url, windowOpen ? driver : null, true, false);
				if (driver == null) {
					setState(State.ERROR, plotId, "No browser available - install Chrome, Firefox or Edge");
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
			if (overview || injectOverlay(target)) {
				setState(State.READY, plotId, null);
			} else {
				setState(State.ERROR, plotId, "The plot outline could not be drawn");
			}
		} catch (Exception e) {
			logger.error("Problems showing the plot in Google Earth Web", e);
			setState(State.ERROR, plotId, "Google Earth Web could not be opened");
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
			data.put("plotUrl", GoogleEarthWebUrls.cameraUrl(plot.getCoord().getLatitude(),
					plot.getCoord().getLongitude(), plot.getElevation(), GoogleEarthWebUrls.PLOT_DISTANCE));
			data.put("inPageNavigation", String.valueOf(inPageNavigation));
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
		watchdog.scheduleWithFixedDelay(this::checkWindow, WATCHDOG_PERIOD_SECONDS, WATCHDOG_PERIOD_SECONDS, TimeUnit.SECONDS);
	}

	/**
	 * Notices a window closed by the user (reported as CLOSED, so the map offers to reopen
	 * it) and re-draws the outline when the page lost it (F5, or a page load started from
	 * the information bar).
	 */
	private void checkWindow() {
		if (state != State.READY || driver == null) {
			return;
		}
		synchronized (lock) {
			if (state != State.READY || driver == null) {
				return;
			}
			if (!browserService.isDriverWorking(driver)) {
				driver = null;
				current = null;
				setState(State.CLOSED, null, null);
				return;
			}
			SimplePlacemarkObject plot = current;
			if (plot == null || !isOnGoogleEarthWeb()) {
				return;
			}
			try {
				Object armed = driver.executeScript("return !!window." + OVERLAY_TAG + ";");
				if (!Boolean.TRUE.equals(armed)) {
					injectOverlay(plot);
				}
			} catch (Exception e) {
				logger.debug("Google Earth Web watchdog check failed", e);
			}
		}
	}

	// ---------- helpers ----------

	private void setState(State newState, String plotId, String message) {
		state = newState;
		statePlotId = plotId;
		stateMessage = message;
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
