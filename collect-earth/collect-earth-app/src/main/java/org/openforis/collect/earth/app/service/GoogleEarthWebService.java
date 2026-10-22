package org.openforis.collect.earth.app.service;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import org.openforis.collect.earth.app.service.imagery.ImageryBrowser;
import org.openforis.collect.earth.app.service.imagery.ImagerySource;
import org.openforis.collect.earth.app.service.imagery.ImageryTab;
import org.openforis.collect.earth.app.service.imagery.PageScriptException;
import org.openforis.collect.earth.app.service.imagery.TabClosedException;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Drives Google Earth Web, the imagery viewer when the plot viewer is "Plots map + Google Earth
 * Web", in its tab of the imagery window ({@link ImageryBrowser}). Google Earth Web has no API:
 * the camera is moved through the page URL and the plot outline is drawn by an injected script
 * (resources/javascript_google_earth_web.fmt).
 *
 * <ul>
 * <li>Requests are coalesced: while the window is busy only the most recent plot is kept,
 * so stepping quickly through plots never replays a backlog.</li>
 * <li>Once loaded, the window is moved to the next plot without reloading when Google Earth
 * Web supports it (detected at run time), otherwise with a single page load.</li>
 * <li>A watchdog re-draws the outline if the page was reloaded and notices a closed tab.</li>
 * <li>While another tab is shown, the camera is not read: nobody can move a hidden map, and the
 * browser slows down the timers of hidden pages, which would report stale positions. A camera
 * move from the plots map meanwhile waits for the tab to be shown, and the outline is redrawn
 * then.</li>
 * <li>The imagery window keeps its browser profile, so Google's cookie consent, sign-in and the
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
	/**
	 * While the tab is hidden, the watchdog asks the browser whether it is still there every this many checks (10 s): a
	 * window closed whole sends no event, and is otherwise noticed only at the next plot.
	 */
	private static final int HIDDEN_LIVENESS_CHECK_TICKS = 20;
	/** As cheap a command as there is: only whether the tab answers matters. */
	private static final String LIVENESS_SCRIPT = "return 1;";
	/** The ground altitude learnt at one place is used for camera URLs up to this far away. */
	private static final double GROUND_ALTITUDE_RANGE_METERS = 50000;
	// Message codes for the plots map, which shows them translated (gew.msg.* in i18n.ts)
	private static final String MESSAGE_NO_BROWSER = "no_browser";
	private static final String MESSAGE_OUTLINE_FAILED = "outline_failed";
	private static final String MESSAGE_OPEN_FAILED = "open_failed";

	/** Information bar texts in the Collect Earth UI language (Messages*.properties). */
	private static final String[] LABEL_KEYS = { "plot", "hintTilted", "hintOutOfView", "hintUnavailable", "topDown",
			"topDownTooltip" };
	/** How long a page load of Google Earth Web may take; its WebGL start is slow on a slow machine. */
	private static final Duration PAGE_LOAD_TIMEOUT = Duration.ofSeconds(60);

	/** Camera URL, window size and whether the overlay is armed, in one round trip. */
	private static final String PAGE_STATE_SCRIPT = "return [location.href, window.innerWidth, window.innerHeight, !!window."
			+ OVERLAY_TAG + "];";

	/**
	 * Pushes the plot URL onto the history and fires popstate, which Google Earth Web's
	 * router may follow by flying the camera. The previous plot's overlay is stopped first:
	 * it reads the camera from the URL and would draw the old plot at the new position.
	 */
	private static final String IN_PAGE_NAVIGATION_SCRIPT =
			"var o = window." + OVERLAY_TAG + "; if (o && o.stop) { o.stop(); }"
			+ "history.pushState(null, '', arguments[0]);"
			+ "window.dispatchEvent(new PopStateEvent('popstate', { state: null }));";

	/**
	 * The same, keeping the overlay: the plot does not change, only where the camera looks. The overlay
	 * hides until the camera has flown there.
	 */
	private static final String CAMERA_MOVE_SCRIPT = "history.pushState(null, '', arguments[0]);"
			+ "window.dispatchEvent(new PopStateEvent('popstate', { state: null }));"
			+ "var o = window." + OVERLAY_TAG + "; if (o && o.expectFlight) { o.expectFlight(arguments[0]); }";

	private final Logger logger = LoggerFactory.getLogger(GoogleEarthWebService.class);

	@Autowired
	private BrowserService browserService;

	@Autowired
	private GeolocalizeMapService geolocalizeMapService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private ImageryBrowser imageryBrowser;

	private final Object lock = new Object();
	private final AtomicReference<SimplePlacemarkObject> pending = new AtomicReference<>();
	/** The plot currently shown (null: overview, or nothing yet). */
	private volatile SimplePlacemarkObject current;
	/** Whether Google Earth Web follows in-page navigation; null until tried once. */
	private volatile Boolean inPageNavigation;

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
	/** The latest camera position asked for while the tab was hidden, applied when it is shown; null if none. */
	private final AtomicReference<double[]> cameraWhileHidden = new AtomicReference<>();
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

	private volatile ScheduledExecutorService watchdog;
	/** Watchdog checks since the tab was last seen visible, or since the last liveness check; watchdog thread only. */
	private int hiddenTicks;

	/**
	 * The tab being shown again redraws the outline at once (the page's timers were slowed down
	 * while hidden) and applies the camera move asked for meanwhile. On the watchdog's thread, not
	 * the one of the listeners: that may wait for {@link #lock} for as long as a page load, and
	 * would hold up the other listeners meanwhile.
	 */
	@PostConstruct
	void listenToTheImageryWindow() {
		imageryBrowser.onVisibilityChange((source, visible) -> {
			if (source != ImagerySource.GOOGLE_EARTH_WEB || !visible) {
				return;
			}
			ScheduledExecutorService thread = watchdog;
			if (thread == null) {
				return; // never opened: nothing to redraw
			}
			try {
				thread.execute(this::shown);
			} catch (RejectedExecutionException e) {
				// shut down
			}
		});
	}

	private ImageryTab tab() {
		return imageryBrowser.tab(ImagerySource.GOOGLE_EARTH_WEB);
	}

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
		if (!localPropertiesService.isGoogleEarthWebViewer() || tab().isOpen()) {
			return;
		}
		synchronized (lock) {
			if (!tab().isOpen() && pending.get() == null && current == null) {
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
				try {
					if (tab().isOpen() && current == shown) {
						injectOverlay(shown);
					}
				} catch (TabClosedException e) {
					// the watchdog sees it
				}
			}
		}
	}

	/**
	 * Moves the Google Earth Web camera to where the user moved the plots map: over that point, with
	 * the same height of ground in view. Only in-page ( a page load per map move would be unusable ),
	 * only while a plot or the overview is shown, and never over a plot shown since it was asked for.
	 * Requests are coalesced like the plots: the latest one wins. While the tab is hidden the latest
	 * one is kept, and applied when it is shown.
	 */
	public void moveCamera(double latitude, double longitude, double heightMeters) {
		if (!canMoveCamera()) {
			return;
		}
		moveCamera(latitude, longitude, heightMeters, showCount.get());
	}

	/** Whether the camera can follow the plots map at all: in Google Earth Web, and only by in-page navigation. */
	private boolean canMoveCamera() {
		return localPropertiesService.isGoogleEarthWebViewer() && !Boolean.FALSE.equals(inPageNavigation);
	}

	/**
	 * @param requestedAfterShow the {@link #showCount} the move belongs to: dropped once another plot was shown, which
	 *                           flew the camera to itself. A move kept while the tab was hidden carries the count from
	 *                           when the tab was shown again, so that it never lands on a plot shown since.
	 */
	private void moveCamera(double latitude, double longitude, double heightMeters, long requestedAfterShow) {
		if (!tab().isVisible()) {
			cameraWhileHidden.set(new double[] { latitude, longitude, heightMeters });
			return;
		}
		pendingCamera.set(new double[] { latitude, longitude, heightMeters });
		synchronized (lock) {
			double[] target = pendingCamera.getAndSet(null);
			if (target == null || showCount.get() != requestedAfterShow || state != State.READY || !tab().isOpen()) {
				return;
			}
			try {
				String href = tab().currentUrl();
				if (!GoogleEarthWebUrls.isGoogleEarthWeb(href)) {
					return;
				}
				// Aimed at the ground: the distance is then the height above it, as the map assumes
				Double current = GoogleEarthWebUrls.cameraAltitude(href);
				double altitude = Math.round(altitudeAt(target[0], target[1], current == null ? 0 : current));
				writtenAltitude = altitude;
				tab().evaluate(CAMERA_MOVE_SCRIPT,
						GoogleEarthWebUrls.movedCameraUrl(href, target[0], target[1], target[2], altitude));
			} catch (Exception e) {
				logger.debug("Could not move the Google Earth Web camera", e);
			}
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
		// A camera move asked for while the tab was hidden belongs to the plot shown before
		cameraWhileHidden.set(null);
		String url = plotUrl(target, overview ? GoogleEarthWebUrls.OVERVIEW_DISTANCE : GoogleEarthWebUrls.PLOT_DISTANCE);
		try {
			try {
				showIn(target, overview, plotId, url);
			} catch (TabClosedException e) {
				// The user closed the tab or the window while it loaded, or closed the whole window since the last
				// plot, which the browser tells at the first command only: once more, in a tab opened anew
				logger.warn("Google Earth Web: {}; opening it again", e.getMessage());
				showIn(target, overview, plotId, url);
			}
		} catch (TabClosedException e) {
			// Closed again: the user does not want it now, and the plots map offers to open it
			logger.warn("Google Earth Web: {}", e.getMessage());
			closed();
		} catch (RuntimeException e) {
			if (BrowserService.isCausedBy(e, BrowserNotFoundException.class)) {
				logger.warn("Google Earth Web: no browser for the imagery window: {}", e.getMessage());
				setState(State.ERROR, plotId, MESSAGE_NO_BROWSER);
			} else if (e instanceof IllegalStateException || e instanceof PageScriptException) {
				// A browser busy, hung or slow to start, a script that failed: reported by ImageryBrowser when a fault
				logger.warn("Google Earth Web: the plot could not be shown: {}", e.getMessage());
				setState(State.ERROR, plotId, MESSAGE_OPEN_FAILED);
			} else {
				logger.error("Problems showing the plot in Google Earth Web", e);
				setState(State.ERROR, plotId, MESSAGE_OPEN_FAILED);
			}
		}
	}

	/** Moves the tab to the plot, in-page when it can, else with a page load that opens the tab if needed. */
	private void showIn(SimplePlacemarkObject target, boolean overview, String plotId, String url) {
		boolean tabOpen = tab().isOpen();
		String href = tabOpen ? pageUrl() : null;
		// A tab opened blank by the plot change (PlacemarkBrowserServlet opens the tabs first) is new all the same: the
		// plots map says "opening", not "moving". A new window is laid out by WindowLayoutService when its browser starts.
		boolean newTab = !tabOpen || (href != null && href.startsWith("about:"));
		boolean moved = false;
		if (tabOpen && !Boolean.FALSE.equals(inPageNavigation) && GoogleEarthWebUrls.isGoogleEarthWeb(href)) {
			setState(State.MOVING, plotId, null);
			moved = navigateInPage(url, target);
		}
		if (!moved) {
			setState(newTab ? State.OPENING : State.MOVING, plotId, null);
			// The camera URL changes the path, so a navigation loads the page: no reload needed
			if (!tab().load(url, false, PAGE_LOAD_TIMEOUT)) {
				logger.warn("Google Earth Web did not load in time");
			}
		}
		startWatchdog();
		current = overview ? null : target;
		if (!isOnGoogleEarthWeb()) {
			// Cookie consent, sign-in...: the watchdog shows the plot once the user is through
			setState(State.WAITING, plotId, null);
			return;
		}
		// After an in-page move the camera is still flying: the outline waits for it to arrive
		if (overview || injectOverlay(target, moved ? url : null)) {
			setState(State.READY, plotId, null);
		} else {
			setState(State.ERROR, plotId, MESSAGE_OUTLINE_FAILED);
		}
	}

	/** Already showing this plot in an open tab (e.g. the same plot clicked twice). */
	private boolean isShowing(SimplePlacemarkObject target) {
		SimplePlacemarkObject shown = current;
		try {
			return shown != null && state == State.READY && target.getPlacemarkId() != null
					&& target.getPlacemarkId().equals(shown.getPlacemarkId())
					&& tab().isOpen() && isOnGoogleEarthWeb();
		} catch (TabClosedException e) {
			return false; // shown again, in a new tab
		}
	}

	/**
	 * Moves the loaded page to the plot without reloading it (a reload costs several seconds
	 * of WebGL start-up and imagery loading). Google Earth Web rewrites the URL while its
	 * camera moves, so a URL that is still exactly the one pushed after a few seconds means
	 * it ignored the request: the caller then loads the page, and this is not tried again. Unless
	 * the tab was hidden meanwhile: a hidden Google Earth Web may not fly until it is shown, which
	 * says nothing about whether it follows in-page navigation.
	 */
	private boolean navigateInPage(String url, SimplePlacemarkObject target) {
		try {
			boolean visibleThroughout = tab().isVisible();
			tab().evaluate(IN_PAGE_NAVIGATION_SCRIPT, url);
			double latitude = Double.parseDouble(target.getCoord().getLatitude());
			double longitude = Double.parseDouble(target.getCoord().getLongitude());
			long end = System.currentTimeMillis() + IN_PAGE_NAVIGATION_TIMEOUT_MILLIS;
			while (System.currentTimeMillis() < end) {
				Thread.sleep(250);
				visibleThroughout &= tab().isVisible();
				String href = tab().currentUrl();
				if (!url.equals(href) && GoogleEarthWebUrls.isCameraAt(href, latitude, longitude)) {
					inPageNavigation = Boolean.TRUE;
					return true;
				}
			}
			if (inPageNavigation == null && visibleThroughout && tab().isVisible()) {
				logger.info("Google Earth Web does not follow in-page navigation; plots will be loaded with a page load");
				inPageNavigation = Boolean.FALSE;
			}
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		} catch (TabClosedException e) {
			throw e; // for show(), which opens the tab again
		} catch (Exception e) {
			logger.warn("In-page navigation in Google Earth Web failed: {}", e.getMessage());
		}
		return false;
	}

	private boolean isOnGoogleEarthWeb() {
		return GoogleEarthWebUrls.isGoogleEarthWeb(pageUrl());
	}

	/**
	 * The URL of the page in the tab, or null when it cannot be read (the page is replacing its
	 * document, the browser is busy). A closed tab is for {@link #show} to deal with.
	 */
	private String pageUrl() {
		try {
			return tab().currentUrl();
		} catch (TabClosedException e) {
			throw e;
		} catch (RuntimeException e) {
			return null;
		}
	}

	/** Injects the plot outline and the information bar (see javascript_google_earth_web.fmt). */
	private boolean injectOverlay(SimplePlacemarkObject plot) {
		return injectOverlay(plot, null);
	}

	/**
	 * @param flightUrl camera URL Google Earth Web was just sent flying to in-page: nothing is drawn before it
	 *                  arrives, or the plot would show over the moving imagery. Null when the camera is there.
	 */
	private boolean injectOverlay(SimplePlacemarkObject plot, String flightUrl) {
		try {
			Map<String, Object> data = geolocalizeMapService.getPlacemarkData(plot);
			data.put("plotId", plot.getPlacemarkId() == null ? "" : plot.getPlacemarkId());
			data.put("plotUrl", plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE));
			data.put("inPageNavigation", String.valueOf(inPageNavigation));
			data.put("flightUrl", flightUrl == null ? "" : flightUrl);
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
			tab().evaluate(script);
			return true;
		} catch (TabClosedException e) {
			throw e;
		} catch (PageScriptException e) {
			// Reported to Sentry by ImageryBrowser already
			logger.warn("Could not draw the plot outline in Google Earth Web: {}", e.getMessage());
			return false;
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
	 * Every 0.5 s while the tab shows a plot or waits for the user: notices a tab or window closed
	 * by the user (CLOSED, so the map offers to reopen it), tracks where the camera looks (the
	 * map follows it), shows the plot once Google lets the user through (WAITING -> READY) and
	 * re-draws the outline when the page lost it (F5, a page load from the information bar).
	 * Nothing of that while another tab is shown: see the class comment. Whether the tab is open
	 * and visible is known without asking the browser, so a hidden tab costs only a trivial command
	 * every 10 s, to notice the whole window being closed (see {@link #checkStillThere()}).
	 */
	private void checkWindow() {
		if (state != State.READY && state != State.WAITING) {
			return;
		}
		synchronized (lock) {
			if (state != State.READY && state != State.WAITING) {
				return;
			}
			if (!tab().isOpen()) {
				closed();
				return;
			}
			if (!tab().isVisible()) {
				checkStillThere();
				return;
			}
			hiddenTicks = 0;
			try {
				// Never starts a browser: a window closed since the check above is seen as closed
				List<?> page = (List<?>) tab().evaluateIfOpen(PAGE_STATE_SCRIPT);
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
						tab().load(plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE), false, PAGE_LOAD_TIMEOUT);
					}
					if (plot == null || injectOverlay(plot)) {
						setState(State.READY, plotId, null);
					}
				} else if (plot != null && !armed) {
					injectOverlay(plot);
				}
			} catch (TabClosedException e) {
				closed();
			} catch (Exception e) {
				logger.debug("Google Earth Web watchdog check failed", e);
			}
		}
	}

	/**
	 * While the tab is hidden, every {@link #HIDDEN_LIVENESS_CHECK_TICKS} checks: sends the browser a trivial command,
	 * which fails with {@link TabClosedException} when the user closed the whole window from another tab. That sends
	 * no event, so the tab still looks open; without asking, Google Earth Web would stay READY and the plots map would
	 * not offer to open it again until the next plot. Called holding {@link #lock}, on the watchdog's thread.
	 */
	private void checkStillThere() {
		if (++hiddenTicks < HIDDEN_LIVENESS_CHECK_TICKS) {
			return;
		}
		hiddenTicks = 0;
		try {
			// Asking with a command that opens the tab would start a new window to find out that the last one closed
			tab().evaluateIfOpen(LIVENESS_SCRIPT);
		} catch (TabClosedException e) {
			logger.warn("Google Earth Web: {}", e.getMessage());
			closed();
		} catch (RuntimeException e) {
			logger.debug("Google Earth Web: the hidden tab did not answer", e);
		}
	}

	/** The user closed the tab or the window: the plots map offers to open it again. */
	private void closed() {
		current = null;
		view = null;
		setState(State.CLOSED, null, null);
	}

	/**
	 * The tab is shown again: see {@link #listenToTheImageryWindow()}. On the watchdog's thread. A plot shown while this
	 * waited for {@link #lock} drew its own outline and flew the camera to itself: then neither the outline is redrawn
	 * nor the camera move kept while hidden applied, which would move the camera away from the new plot.
	 */
	private void shown() {
		long shownAt = showCount.get();
		try {
			synchronized (lock) {
				if (showCount.get() != shownAt) {
					return;
				}
				SimplePlacemarkObject plot = current;
				if (state == State.READY && plot != null && tab().isOpen()) {
					injectOverlay(plot);
				}
			}
			double[] camera = cameraWhileHidden.getAndSet(null);
			if (camera != null && canMoveCamera()) {
				moveCamera(camera[0], camera[1], camera[2], shownAt);
			}
		} catch (TabClosedException e) {
			// closed right after it was shown: the watchdog sees it
		} catch (RuntimeException e) {
			logger.warn("Google Earth Web: could not redraw the plot after its tab was shown: {}", e.getMessage());
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
}
