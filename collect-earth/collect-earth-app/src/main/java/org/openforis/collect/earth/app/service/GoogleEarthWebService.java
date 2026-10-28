package org.openforis.collect.earth.app.service;

import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import org.openforis.collect.earth.app.desktop.ServerController;
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
	/** How long Chrome may take to show the title of a page as the one of its window. */
	private static final long WINDOW_TITLE_DELAY_MILLIS = 1000;
	/** The plots map in a panel of the page, with the "plots map inside Google Earth Web" layout. */
	private static final String PANEL_TEMPLATE = "resources/javascript_plots_map_panel.fmt";
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
	/**
	 * How long the watchdog leaves the page alone after it was too busy to run its check (Google Earth Web starting):
	 * each check of a busy page holds up the commands of the other tabs for the timeout of a script.
	 */
	private static final long BUSY_PAGE_PAUSE_MILLIS = 5000;
	/** How often, and how many times, the watchdog draws again an outline that could not be drawn: see {@link #retryOutline()}. */
	private static final long OUTLINE_RETRY_MILLIS = 5000;
	private static final int OUTLINE_RETRIES = 12;
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

	/** What injecting the plot outline came to. */
	private enum Outline { DRAWN, PAGE_NOT_READY, FAILED }

	/** Whether the document can take the outline; cannot throw, so a page not ready is never taken as a fault. */
	private static final String BODY_READY_SCRIPT = "return !!document.body;";
	private static final Duration BODY_READY_TIMEOUT = Duration.ofSeconds(5);
	/** What the overlay template returns when the document had no body to draw in. */
	private static final String OVERLAY_NO_BODY = "no_body";

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

	/** The address of the plots map in the panel of the page, null when it has none; see {@link #syncPanel()}. */
	private volatile String panelShown;
	private volatile String panelScript;

	private final Object lock = new Object();
	/** The plot to show next, the one of the latest selection that arrived; see {@link #showPlot}. */
	private final AtomicReference<Selection> pending = new AtomicReference<>();
	/** The selection number of the plot shown last (see {@link #showPlot}); guarded by {@link #lock}. */
	private long shownSelection = Long.MIN_VALUE;
	/** The plot currently shown (null: overview, or nothing yet). */
	private volatile SimplePlacemarkObject current;
	/** Whether Google Earth Web follows in-page navigation; null until tried once. */
	private volatile Boolean inPageNavigation;

	private volatile State state = State.CLOSED;
	private volatile String statePlotId;
	private volatile String stateMessage;
	/** Where the Google Earth Web camera looks (null when unknown or not top-down). */
	private volatile Map<String, Object> view;
	/**
	 * Neighbouring plots sent by the plots map for one plot, replaced as a whole: the id and the JSON written apart could
	 * be read as the id of one plot with the neighbours of the one before.
	 */
	private volatile Context context = new Context(null, "[]");
	/** The context the outline was drawn with last; guarded by {@link #lock}. See {@link #contextChangedFor}. */
	private Context drawnContext;
	/** Whether a redraw for new neighbours is queued on the watchdog's thread and has not started: see {@link #setContext}. */
	private final AtomicBoolean redrawQueued = new AtomicBoolean();
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
	/** Altitude of the top-down view the overlay drawn last loads with its button; see {@link #topDownUrl}. */
	private volatile Double topDownAltitude;
	/** A camera this near (~1 cm) the point Collect Earth sent it to is still over it: see {@link #aimAtTheGround}. */
	private static final double EXACT_DEGREES = 1e-7;
	/** Google Earth Web stops a camera aimed below the ground 10 m from it: see {@link #aimAtTheGround}. */
	private static final double STOPPED_SHORT_METERS = 20;
	/** The {@link #showCount} of the plot flown to again aimed at the ground (see {@link #aimAtTheGround}). */
	private long groundAimedFor = -1;

	private volatile ScheduledExecutorService watchdog;
	/** Watchdog checks since the tab was last seen visible, or since the last liveness check; watchdog thread only. */
	private int hiddenTicks;
	/** Until when the watchdog leaves a page alone that was too busy to answer it; watchdog thread only. */
	private long busyUntilNanos = System.nanoTime();
	/** How many more times the watchdog draws an outline that failed, and not before when; guarded by {@link #lock}. */
	private int outlineRetriesLeft;
	private long nextOutlineRetryNanos = System.nanoTime();

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

	/** A plot to show, with the number of its selection. */
	private static final class Selection {
		final SimplePlacemarkObject plot;
		final long number;

		Selection(SimplePlacemarkObject plot, long number) {
			this.plot = plot;
			this.number = number;
		}
	}

	/**
	 * Shows the plot in Google Earth Web (opening the window if needed). Returns at once if a newer request arrived
	 * while this one waited for the window, or if a plot selected after this one was shown already: each selection
	 * comes on a thread of its own, so the plot of an earlier one can arrive here last.
	 *
	 * @param selection the number of the plot selection, increasing from one selection to the next (see
	 *                  {@code PlotImageryService}); the plot of the selection shown last is shown again
	 */
	public void showPlot(SimplePlacemarkObject plot, long selection) {
		if (!isTheViewer()) {
			return;
		}
		// The waiting plot of a later selection is not replaced by the one of an earlier selection
		pending.accumulateAndGet(new Selection(plot, selection),
				(waiting, arrived) -> waiting != null && waiting.number > arrived.number ? waiting : arrived);
		synchronized (lock) {
			Selection target = pending.getAndSet(null);
			if (target != null && target.number >= shownSelection) {
				shownSelection = target.number;
				showSelected(target.plot);
			}
		}
	}

	/**
	 * Whether Google Earth Web is closed: never opened, or its tab or window closed by the user (the watchdog notices).
	 * Not while it opens.
	 */
	public boolean isClosed() {
		return state == State.CLOSED;
	}

	/** Whether Google Earth Web is the plot viewer. */
	boolean isTheViewer() {
		return localPropertiesService.isGoogleEarthWebViewer();
	}

	/** Shows the plot of the latest selection; holding {@link #lock}. */
	void showSelected(SimplePlacemarkObject plot) {
		show(plot, false);
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
	 * Neighbouring plots (id, status, rings) to draw around {@code plotId}, sent by the plots map with each selection.
	 * Returns at once: the outline is redrawn with them on the watchdog's thread if that plot is shown, by the plot being
	 * shown once it is (see {@link #showIn}), or by the watchdog's next check. Never waiting for {@link #lock} here, which
	 * a plot being shown holds for as long as a page load: the request threads of the plots map would wait as long, and
	 * a few of them would take every connection the browser opens to Collect Earth.
	 * <p>
	 * One redraw queued at most: while it waits (for the lock held through a page load, say), the neighbours sent
	 * meanwhile are all drawn by it, as it reads the latest when it runs. A redraw queued while it runs is queued anew.
	 */
	public void setContext(String plotId, String plotsJson) {
		context = new Context(plotId, plotsJson);
		ScheduledExecutorService thread = watchdog;
		if (thread != null && redrawQueued.compareAndSet(false, true)) {
			try {
				thread.execute(this::redrawForNewContext);
			} catch (RejectedExecutionException e) {
				redrawQueued.set(false); // shut down
			}
		}
	}

	/** On the watchdog's thread: see {@link #setContext}. */
	private void redrawForNewContext() {
		// Before reading the neighbours: those sent from now on queue a redraw of their own
		redrawQueued.set(false);
		try {
			synchronized (lock) {
				redrawIfContextChanged();
			}
		} catch (TabClosedException e) {
			// the watchdog sees it
		} catch (RuntimeException e) {
			logger.debug("Google Earth Web: could not redraw the plot with its neighbours", e);
		}
	}

	/**
	 * Redraws the outline of the plot shown if the plots map sent its neighbours since it was drawn. Holding the lock.
	 * Not while the tab is hidden (see the class comment): {@link #shown()} redraws the outline, with the latest
	 * neighbours, when it is shown again.
	 */
	private void redrawIfContextChanged() {
		SimplePlacemarkObject plot = current;
		if (state == State.READY && plot != null && contextChangedFor(plot) && tab().isOpen() && tab().isVisible()) {
			injectOverlay(plot);
		}
	}

	/** Whether the neighbours of the plot came after its outline was drawn. Holding the lock. */
	private boolean contextChangedFor(SimplePlacemarkObject plot) {
		Context sent = context;
		return sent != drawnContext && plot.getPlacemarkId() != null && plot.getPlacemarkId().equals(sent.plotId);
	}

	/** Neighbouring plots of a plot, as JSON. */
	private static final class Context {
		final String plotId;
		final String json;

		Context(String plotId, String json) {
			this.plotId = plotId;
			this.json = json;
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
				tab().evaluate(CAMERA_MOVE_SCRIPT, movedCameraUrl(href, target[0], target[1], target[2]));
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
		Outline outline = overview ? Outline.DRAWN : injectOverlay(target, moved ? url : null);
		if (outline == Outline.DRAWN) {
			setState(State.READY, plotId, null);
			// Neighbours sent while the plot was being shown, after its outline read them (setContext leaves the redraw to
			// the watchdog, which may not have started yet)
			redrawIfContextChanged();
		} else if (outline == Outline.PAGE_NOT_READY) {
			// The watchdog draws it once the page is there
			setState(State.WAITING, plotId, null);
		} else {
			outlineFailed(plotId);
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
	private Outline injectOverlay(SimplePlacemarkObject plot) {
		return injectOverlay(plot, null);
	}

	/**
	 * Injects the outline only into a document that has a body: Google Earth Web redirects on its way to the app, so a
	 * page that just loaded may be a new document still being built, and the outline would have nowhere to go. That
	 * is waited for a few seconds (with a script that cannot throw), and the template checks it again itself, as the
	 * document may be replaced once more in between. A page not ready is not a fault, and not reported: the watchdog
	 * draws the outline once the page is there.
	 *
	 * @param flightUrl camera URL Google Earth Web was just sent flying to in-page: nothing is drawn before it
	 *                  arrives, or the plot would show over the moving imagery. Null when the camera is there.
	 */
	private Outline injectOverlay(SimplePlacemarkObject plot, String flightUrl) {
		try {
			if (!tab().waitUntil(BODY_READY_SCRIPT, BODY_READY_TIMEOUT)) {
				logger.warn("Google Earth Web: the page has no body yet, the plot outline is drawn later");
				return Outline.PAGE_NOT_READY;
			}
			Map<String, Object> data = geolocalizeMapService.getPlacemarkData(plot);
			data.put("plotId", plot.getPlacemarkId() == null ? "" : plot.getPlacemarkId());
			data.put("plotUrl", topDownUrl(plot));
			data.put("inPageNavigation", String.valueOf(inPageNavigation));
			data.put("flightUrl", flightUrl == null ? "" : flightUrl);
			Map<String, String> labels = new LinkedHashMap<>();
			for (String key : LABEL_KEYS) {
				labels.put(key, Messages.getString("GoogleEarthWeb." + key));
			}
			data.put("labels", labels);
			Context neighbours = context;
			data.put("neighboursJson", plot.getPlacemarkId() != null && plot.getPlacemarkId().equals(neighbours.plotId) ? neighbours.json : "[]");
			String script = browserService.processJavascriptTemplate(data, OVERLAY_TEMPLATE);
			if (script == null) {
				return Outline.FAILED;
			}
			// First, as the outline is drawn beside it
			syncPanel();
			if (OVERLAY_NO_BODY.equals(tab().evaluate(script))) {
				logger.warn("Google Earth Web: the page was replaced by one with no body yet, the plot outline is drawn later");
				return Outline.PAGE_NOT_READY;
			}
			drawnContext = neighbours;
			return Outline.DRAWN;
		} catch (TabClosedException e) {
			throw e;
		} catch (PageScriptException e) {
			if (!e.isFault()) {
				logger.warn("Google Earth Web: the page was being replaced or busy, the plot outline is drawn later");
				return Outline.PAGE_NOT_READY;
			}
			// Reported to Sentry by ImageryBrowser already
			logger.warn("Could not draw the plot outline in Google Earth Web: {}", e.getMessage());
			return Outline.FAILED;
		} catch (Exception e) {
			logger.warn("Could not draw the plot outline in Google Earth Web", e);
			return Outline.FAILED;
		}
	}

	/**
	 * Shows the plots map in a panel on the left of the page, or takes it away, as the window layout wants (see
	 * javascript_plots_map_panel.fmt): with the outline, as a page loaded anew lost both, and when the layout changes.
	 * A failure leaves Google Earth Web as it is, with the plots map in its own window.
	 */
	private void syncPanel() {
		String url = panelUrl();
		try {
			String script = panelScript;
			if (script == null) {
				script = browserService.processJavascriptTemplate(new HashMap<>(), PANEL_TEMPLATE);
				if (script == null) {
					return;
				}
				panelScript = script;
			}
			Object result = tab().evaluateIfOpen(script, url, BrowserService.PLOTS_IN_GOOGLE_EARTH_WEB_TITLE);
			if (!"no_body".equals(result)) {
				panelShown = url;
			}
			if ("shown".equals(result) || "removed".equals(result)) {
				markWindowsSoon(); // the page has another title, and its window another icon
			}
		} catch (TabClosedException e) {
			throw e;
		} catch (Exception e) {
			logger.warn("Google Earth Web: the plots map panel could not be {}: {}", url == null ? "removed" : "shown",
					e.getMessage());
		}
	}

	/**
	 * The address of the plots map for the panel, or null when the window layout wants none: with ?panel, as it shows
	 * only the plot list and the form there (panel.ts), Google Earth Web being the map.
	 */
	private String panelUrl() {
		if (!localPropertiesService.isPlotsMapInGoogleEarthWeb()) {
			return null;
		}
		return BrowserService.leafletMapUrl(ServerController.getHostAddress(localPropertiesService.getHost(),
				localPropertiesService.getLocalPort()), null) + "?panel";
	}

	/**
	 * Gives the windows of the imagery browser their icons again once Chrome took the new title of the page as the one
	 * of its window, which it does on its own time; on a thread of its own, not to hold up the watchdog.
	 */
	private void markWindowsSoon() {
		Thread mark = new Thread(() -> {
			try {
				Thread.sleep(WINDOW_TITLE_DELAY_MILLIS);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				return;
			}
			browserService.markImageryWindows();
		}, "Imagery window icons");
		mark.setDaemon(true);
		mark.start();
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
	 * re-draws the outline when the page lost it (F5, a page load from the information bar), or
	 * could not take it (see {@link #retryOutline()}). Nothing of that while another tab is shown: see the class comment. Whether the tab is open
	 * and visible is known without asking the browser, so a hidden tab costs only a trivial command
	 * every 10 s, to notice the whole window being closed (see {@link #checkStillThere()}).
	 */
	private void checkWindow() {
		if (state == State.ERROR) {
			retryOutline();
			return;
		}
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
			if (System.nanoTime() - busyUntilNanos < 0) {
				return; // the page was too busy to answer just now: not asked again for a while
			}
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
				if (state == State.READY && plot != null && aimAtTheGround(href, plot)) {
					return;
				}
				if (!Objects.equals(panelUrl(), panelShown)) {
					syncPanel(); // the window layout was changed
				}
				double[] camera = GoogleEarthWebUrls.cameraPosition(href);
				view = GoogleEarthWebUrls.cameraView(href, ((Number) page.get(1)).doubleValue(), ((Number) page.get(2)).doubleValue(),
						camera == null ? null : groundAltitudeNear(camera[0], camera[1]));
				if (state == State.WAITING) {
					// Through consent / sign-in: Google may have dropped the camera position
					if (plot != null && !GoogleEarthWebUrls.isCameraAt(href, Double.parseDouble(plot.getCoord().getLatitude()),
							Double.parseDouble(plot.getCoord().getLongitude()))) {
						tab().load(plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE), false, PAGE_LOAD_TIMEOUT);
					}
					if (plot == null || injectOverlay(plot) == Outline.DRAWN) {
						setState(State.READY, plotId, null);
					}
				} else if (plot != null && (!armed || contextChangedFor(plot))) {
					injectOverlay(plot);
				}
			} catch (TabClosedException e) {
				closed();
			} catch (PageScriptException e) {
				if (e.isPageBusy()) {
					// Google Earth Web starting: each check would hold up the imagery window for as long again
					busyUntilNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(BUSY_PAGE_PAUSE_MILLIS);
				}
				logger.debug("Google Earth Web watchdog check failed", e);
			} catch (Exception e) {
				logger.debug("Google Earth Web watchdog check failed", e);
			}
		}
	}

	/**
	 * A plot of no known elevation, with no ground learnt near it, is flown to aimed at sea level. Over hills Google Earth
	 * Web then stops the camera as near to the ground as it lets it (10 m), and writes the distance cut short, with the
	 * altitude of the ground or the one it was given: the plot fills the window many times over, and only its central
	 * sample point is left in view, looking like the plot without its sample points. The ground is learnt, and the plot
	 * flown to again aimed at it. Once per plot shown, and only for a camera still exactly over the point Collect Earth
	 * sent it to (a zoom of the user moves it towards the pointer). Holding {@link #lock}.
	 *
	 * @return whether the camera was sent to the plot again
	 */
	private boolean aimAtTheGround(String href, SimplePlacemarkObject plot) {
		long shown = showCount.get();
		if (groundAimedFor == shown || !learnGroundUnderACameraStoppedShort(href, plot)) {
			return false;
		}
		groundAimedFor = shown;
		String url = plotUrl(plot, GoogleEarthWebUrls.PLOT_DISTANCE);
		logger.info("Google Earth Web stopped the camera {} m from the ground of plot {}: flown there again aimed at {} m",
				Math.round(GoogleEarthWebUrls.cameraDistance(href)), plot.getPlacemarkId(), Math.round(groundAltitude));
		if (Boolean.TRUE.equals(inPageNavigation)) {
			// The overlay hides until the camera has flown there
			tab().evaluate(CAMERA_MOVE_SCRIPT, url);
		} else {
			tab().load(url, false, PAGE_LOAD_TIMEOUT);
			injectOverlay(plot);
		}
		return true;
	}

	/**
	 * Learns the ground under the plot from a camera Collect Earth sent to it that Google Earth Web stopped short of the
	 * distance (see {@link #aimAtTheGround}): the altitude Google Earth Web aimed it at, or, when it kept the one it was
	 * given, where the camera would have been. False, learning nothing, for any other.
	 */
	boolean learnGroundUnderACameraStoppedShort(String href, SimplePlacemarkObject plot) {
		Double altitude = GoogleEarthWebUrls.cameraAltitude(href);
		Double distance = GoogleEarthWebUrls.cameraDistance(href);
		double[] camera = GoogleEarthWebUrls.cameraPosition(href);
		if (altitude == null || distance == null || camera == null || distance > STOPPED_SHORT_METERS) {
			return false;
		}
		double latitude = Double.parseDouble(plot.getCoord().getLatitude());
		double longitude = Double.parseDouble(plot.getCoord().getLongitude());
		// The URLs carry 8 decimals: still the point sent, not one the user zoomed towards
		if (Math.abs(camera[0] - latitude) > EXACT_DEGREES || Math.abs(camera[1] - longitude) > EXACT_DEGREES) {
			return false;
		}
		groundAltitude = isAbout(altitude, writtenAltitude) ? altitude + GoogleEarthWebUrls.PLOT_DISTANCE - distance : altitude;
		groundAltitudePosition = new double[] { latitude, longitude };
		return true;
	}

	/**
	 * The outline of the plot shown could not be drawn (ERROR, {@link #MESSAGE_OUTLINE_FAILED}): drawn again every
	 * {@link #OUTLINE_RETRY_MILLIS}, {@link #OUTLINE_RETRIES} times at most, while the tab is visible and on Google Earth
	 * Web. A failure can be passing (a page busy in a way that is not known as such, a document replaced as the script
	 * ran), and the camera is on the plot: without this, the plot stayed without its outline until the next one. The
	 * state stays ERROR meanwhile rather than WAITING, which tells the plots map that Google waits for the user, and
	 * would hide a fault that does not pass; a fault is reported to Sentry once per session (see ImageryErrorReporter).
	 * On the watchdog's thread.
	 */
	private void retryOutline() {
		synchronized (lock) {
			SimplePlacemarkObject plot = current;
			if (state != State.ERROR || !MESSAGE_OUTLINE_FAILED.equals(stateMessage) || plot == null
					|| outlineRetriesLeft <= 0 || System.nanoTime() - nextOutlineRetryNanos < 0) {
				return;
			}
			try {
				if (!tab().isOpen()) {
					closed();
					return;
				}
				if (!tab().isVisible()) {
					return; // see the class comment; tried once it is shown
				}
				outlineRetriesLeft--;
				nextOutlineRetryNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(OUTLINE_RETRY_MILLIS);
				if (!isOnGoogleEarthWeb()) {
					return; // the user loaded another page meanwhile
				}
				Outline outline = injectOverlay(plot);
				if (outline == Outline.DRAWN) {
					setState(State.READY, plot.getPlacemarkId(), null);
					redrawIfContextChanged();
				} else if (outline == Outline.PAGE_NOT_READY) {
					// The watchdog draws it once the page is there
					setState(State.WAITING, plot.getPlacemarkId(), null);
				}
			} catch (TabClosedException e) {
				closed();
			} catch (RuntimeException e) {
				logger.debug("Google Earth Web: the plot outline could not be drawn again", e);
			}
		}
	}

	/** The outline failed while the plot was shown: see {@link #retryOutline()}. Holding {@link #lock}. */
	private void outlineFailed(String plotId) {
		outlineRetriesLeft = OUTLINE_RETRIES;
		nextOutlineRetryNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(OUTLINE_RETRY_MILLIS);
		setState(State.ERROR, plotId, MESSAGE_OUTLINE_FAILED);
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
	String plotUrl(SimplePlacemarkObject plot, int distance) {
		int altitude = plotAltitude(plot);
		writtenAltitude = (double) altitude;
		return GoogleEarthWebUrls.cameraUrl(plot.getCoord().getLatitude(), plot.getCoord().getLongitude(), altitude,
				distance);
	}

	/**
	 * The top-down view of the plot that the overlay's button loads (see javascript_google_earth_web.fmt). Not loaded
	 * now, so it leaves {@link #writtenAltitude} alone: the outline is drawn again after a camera move, and the altitude
	 * of that move would then be learnt as ground. Its own altitude is not learnt either, once the button loads it.
	 */
	String topDownUrl(SimplePlacemarkObject plot) {
		int altitude = plotAltitude(plot);
		topDownAltitude = (double) altitude;
		return GoogleEarthWebUrls.cameraUrl(plot.getCoord().getLatitude(), plot.getCoord().getLongitude(), altitude,
				GoogleEarthWebUrls.PLOT_DISTANCE);
	}

	/** The altitude a camera URL of the plot aims at: its elevation, or else the ground learnt nearby, or else 0. */
	private int plotAltitude(SimplePlacemarkObject plot) {
		int altitude = plot.getElevation();
		if (altitude <= 0) {
			try {
				altitude = (int) Math.round(altitudeAt(Double.parseDouble(plot.getCoord().getLatitude()),
						Double.parseDouble(plot.getCoord().getLongitude()), 0));
			} catch (NumberFormatException e) {
				altitude = 0;
			}
		}
		return altitude;
	}

	/**
	 * The camera URL that moves Google Earth Web from {@code href} to where the plots map looks, aimed at the ground: the
	 * distance is then the height above it, as the map assumes. Its altitude is written, so not learnt.
	 */
	String movedCameraUrl(String href, double latitude, double longitude, double heightMeters) {
		Double current = GoogleEarthWebUrls.cameraAltitude(href);
		double altitude = Math.round(altitudeAt(latitude, longitude, current == null ? 0 : current));
		writtenAltitude = altitude;
		return GoogleEarthWebUrls.movedCameraUrl(href, latitude, longitude, heightMeters, altitude);
	}

	private double altitudeAt(double latitude, double longitude, double fallback) {
		Double ground = groundAltitudeNear(latitude, longitude);
		return ground == null ? fallback : ground;
	}

	Double groundAltitudeNear(double latitude, double longitude) {
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
	 * a guess would otherwise be carried from plot to plot. Nor the altitude of the overlay's top-down view, which the
	 * user loads with its button.
	 */
	void learnGroundAltitude(String href) {
		Double altitude = GoogleEarthWebUrls.cameraAltitude(href);
		double[] camera = GoogleEarthWebUrls.cameraPosition(href);
		if (altitude != null && camera != null && !isAbout(altitude, writtenAltitude) && !isAbout(altitude, topDownAltitude)) {
			groundAltitude = altitude;
			groundAltitudePosition = camera;
		}
	}

	private static boolean isAbout(double altitude, Double written) {
		return written != null && Math.abs(altitude - written) <= 0.5;
	}

	private void setState(State newState, String plotId, String message) {
		state = newState;
		statePlotId = plotId;
		stateMessage = message;
	}
}
