package org.openforis.collect.earth.app.service;

import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import org.openforis.collect.earth.app.service.imagery.ImageryBrowser;
import org.openforis.collect.earth.app.service.imagery.ImagerySource;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Shows a plot in the imagery window: Google Earth Web and the other imagery sources, a tab each. It remembers the
 * plot shown last (or the survey area Google Earth Web was opened over before any plot), so that the imagery window can
 * be opened again on it when the user closed it and asks for the windows back ("Arrange", see
 * {@link WindowLayoutService#arrangeAndBringForward()}). It was the servlet that the plots map calls; it is here so
 * that the window layout can call it too without depending on a controller.
 */
@Component
public class PlotImageryService {

	private final Logger logger = LoggerFactory.getLogger(PlotImageryService.class);

	@Autowired
	private BrowserService browserService;

	@Autowired
	private GoogleEarthWebService googleEarthWebService;

	@Autowired
	private ImageryBrowser imageryBrowser;

	/**
	 * Guards the numbering of the selections, {@link #requested}, {@link #latestSelection} and {@link #lastShown}.
	 * Each selection runs on a thread of its own, and each of its source loads on another: the number a selection takes
	 * when it starts tells the imagery sources which plot is the latest whatever order its loads reach them in (see
	 * {@link ImageryBrowser#loadLatest}).
	 */
	private final Object selectionLock = new Object();
	/** The number of the latest selection, or of the latest Google Earth Web show (see {@link #showInGoogleEarthWeb}). */
	private long selections;
	/**
	 * The number of the latest {@link #showPlot}: one that finds a later one started when its plot is filled in stops.
	 * Back to the number of the plot shown when the latest could not be filled in.
	 */
	private long latestSelection;
	/** The plot asked for last by {@link #showPlot}, before it is filled in: asked for again, it is not shown again. */
	private SimplePlacemarkObject requested;
	/** The plot shown last, its sample points and outline filled in, with its selection; null before the first plot. */
	private volatile Shown lastShown;
	/**
	 * The plot selected last in the plots map, which tells every selection (/openAuxiliaryWindows): a plots map the user
	 * closed comes back on it. Kept apart from {@link #lastShown}, which is set on another thread, after the plot is
	 * filled in, and not when the plot equals the one before.
	 */
	private volatile String selectedPlotId;
	/** Where Google Earth Web was opened before any plot was selected; see {@link #openOverview}. */
	private final AtomicReference<SimplePlacemarkObject> lastOverview = new AtomicReference<>();

	private final ExecutorService executor = Executors.newCachedThreadPool(r -> {
		Thread thread = new Thread(r, "Plot imagery");
		thread.setDaemon(true);
		return thread;
	});
	/** Where the loads run: {@link #executor}, or the calling thread in the tests. */
	Executor async = executor;

	@PreDestroy
	public void shutdown() {
		executor.shutdownNow();
	}

	/** A plot shown, with the number of its selection. */
	private static final class Shown {
		final SimplePlacemarkObject placemark;
		final long selection;

		Shown(SimplePlacemarkObject placemark, long selection) {
			this.placemark = placemark;
			this.selection = selection;
		}
	}

	/**
	 * Shows the plot in every imagery source switched on, unless it is the plot asked for last. Returns once the tabs
	 * are open; the loads of the sources run on threads of their own. Nothing is shown when another plot is selected
	 * while this one is filled in.
	 */
	public void showPlot(SimplePlacemarkObject placemark, KmlGenerator kmlGenerator) {
		long selection;
		synchronized (selectionLock) {
			// If this is the first plot or the plot is different from the last one asked for. Checked against the plot
			// asked for, not the one shown: going A, B, A quickly, the second A is shown although B was not shown yet
			if (Objects.equals(requested, placemark)) {
				return;
			}
			requested = placemark;
			selection = ++selections;
			latestSelection = selection;
		}
		try {
			fillPlot(placemark, kmlGenerator);
		} catch (TransformException | KmlGenerationException e) {
			logger.error("Error generating polygon", e);
			synchronized (selectionLock) {
				if (selection == latestSelection) {
					requested = null; // selected again, it is tried again
					// The plot shown is the latest again: a window opened again loads it (see reopenImagery) instead of
					// leaving it to this selection, which shows nothing
					Shown shown = lastShown;
					latestSelection = shown == null ? 0 : shown.selection;
				}
			}
			return;
		}
		synchronized (selectionLock) {
			if (selection != latestSelection) {
				return; // another plot was selected meanwhile
			}
			lastShown = new Shown(placemark, selection);
		}
		// Google Earth Web first, so that its load is queued early; on a thread of its own, as it waits for the page and
		// its in-page move. In a browser that starts, its tab is the first whichever comes first, its own load or
		// openImageryTabs(), which opens the tabs one by one in the order of ImagerySource
		showInGoogleEarthWeb(placemark, selection);
		openImageryTabs();
		loadInOtherSources(placemark, selection);
	}

	/**
	 * Shows the plot in Google Earth Web even if it is the plot shown last, as a selection of its own: the plots map
	 * asks for it to open a closed Google Earth Web again, or to set it back on its plot. Returns at once.
	 */
	public void showInGoogleEarthWeb(SimplePlacemarkObject placemark, KmlGenerator kmlGenerator) {
		long selection;
		synchronized (selectionLock) {
			selection = ++selections;
		}
		openAsync("Google Earth Web", () -> {
			fillPlot(placemark, kmlGenerator);
			sendToGoogleEarthWeb(placemark, selection);
		});
	}

	/** Fills in the sample points and the outline of the plot. */
	void fillPlot(SimplePlacemarkObject placemark, KmlGenerator kmlGenerator) throws TransformException, KmlGenerationException {
		kmlGenerator.fillSamplePoints(placemark);
		kmlGenerator.fillExternalLine(placemark);
	}

	/** The plots map selected this plot (null or blank: an id is not known, the one before is kept). */
	public void plotSelected(String plotId) {
		if (plotId != null && !plotId.trim().isEmpty()) {
			selectedPlotId = plotId;
		}
	}

	/** The plot selected last in the plots map, or null before the first. */
	public String getSelectedPlotId() {
		return selectedPlotId;
	}

	/**
	 * With the plots map inside Google Earth Web, Google Earth Web opens where the plots map window would (see
	 * {@link BrowserService#plotsMapInGoogleEarthWeb()}).
	 */
	@PostConstruct
	void openGoogleEarthWebForThePlotsMap() {
		browserService.showPlotsMapInGoogleEarthWebWith(plotId -> openForThePlotsMap());
	}

	/**
	 * Opens Google Earth Web for its panel to show the plots map: on the plot shown last, with the other sources, or
	 * before any plot over the survey area, else from afar (the panel then moves it over the survey area, see panel.ts).
	 * Returns at once; true unless there is no Google Earth Web to open.
	 */
	boolean openForThePlotsMap() {
		if (!googleEarthWebService.isTheViewer()) {
			return false;
		}
		if (reopenImagery()) {
			return true;
		}
		SimplePlacemarkObject overview = lastOverview.get();
		openOverview(overview != null ? overview : new SimplePlacemarkObject(new String[] { "0", "0" }));
		return true;
	}

	/** Opens Google Earth Web over the survey area before a plot is selected (a no-op if it is open). */
	public void openOverview(SimplePlacemarkObject center) {
		lastOverview.set(center);
		executor.submit(() -> googleEarthWebService.openOverview(center));
	}

	/**
	 * The user closed the imagery window, and asked for the windows back: opens it again on the plot shown last, or
	 * before any plot over the survey area in Google Earth Web; nothing when neither was ever shown (there is nothing to
	 * show in it yet: the first plot opens it). Returns once its tabs are open, so that the window can be laid out right
	 * after; the plot loads in them on threads of their own. The imagery browser must know the window is gone (see
	 * {@link ImageryBrowser#windowClosed}, which the window layout tells when it finds it closed): it would otherwise take
	 * the tabs of the closed window for open.
	 *
	 * @return whether a window was asked for
	 */
	public boolean reopenImagery() {
		Shown shown;
		long selection = 0;
		synchronized (selectionLock) {
			shown = lastShown;
			// A number of its own, as a selection: Google Earth Web may have been shown since with a number after the
			// plot's (see showInGoogleEarthWeb), and would take the plot's for an older one. Not when a plot selected
			// since is being filled in: that one shows itself, in the window opened here
			if (shown != null && latestSelection == shown.selection) {
				selection = ++selections;
				latestSelection = selection;
				lastShown = new Shown(shown.placemark, selection);
			}
		}
		if (shown != null) {
			// The tabs first, here: opening them starts the new browser, so that the window exists when this returns
			openImageryTabs();
			if (selection != 0) {
				showInGoogleEarthWeb(shown.placemark, selection);
				loadInOtherSources(shown.placemark, selection);
			}
			return true;
		}
		SimplePlacemarkObject overview = lastOverview.get();
		if (overview != null && browserService.enabledImagerySources().contains(ImagerySource.GOOGLE_EARTH_WEB)) {
			executor.submit(() -> googleEarthWebService.openOverview(overview));
			return true;
		}
		return false;
	}

	private void showInGoogleEarthWeb(SimplePlacemarkObject placemark, long selection) {
		openAsync("Google Earth Web", () -> sendToGoogleEarthWeb(placemark, selection));
	}

	/** Shows the plot in Google Earth Web, on the calling thread. */
	void sendToGoogleEarthWeb(SimplePlacemarkObject placemark, long selection) {
		googleEarthWebService.showPlot(placemark, selection);
	}

	/** Sends the plot to each source but Google Earth Web, on threads of their own: each waits for its page. */
	void loadInOtherSources(SimplePlacemarkObject placemark, long selection) {
		openAsync("Earth Engine APP", () -> browserService.openGEEAppURL(placemark, selection));
		openAsync("Earth Map", () -> browserService.openEarthMapURL(placemark, selection));
		openAsync("ESRI Wayback", () -> browserService.openEsriWayback(placemark, selection));
		openAsync("Extra Map", () -> browserService.openExtraMap(placemark, selection));
		openAsync("Street View", () -> browserService.openStreetView(placemark, selection));
		openAsync("Planet Maps", () -> browserService.openPlanetMaps(placemark, selection));
		openAsync("SecureWatch", () -> browserService.openSecureWatch(placemark, selection));
	}

	/**
	 * Opens the tabs of the imagery sources switched on before their loads are sent, so that the tabs are in the order of
	 * {@link ImagerySource} whatever order the loads arrive in. When there is no browser, a warning: the loads that
	 * follow fail at once (a failed start is remembered for a while), and the other windows carry on.
	 */
	void openImageryTabs() {
		Set<ImagerySource> sources = EnumSet.noneOf(ImagerySource.class);
		sources.addAll(browserService.enabledImagerySources());
		// Told on every plot, so that a browser started anew opens the tabs of the sources switched on now, not of those
		// on when a tab was last missing
		imageryBrowser.rememberTabs(sources);
		if (sources.isEmpty()) {
			return;
		}
		// Mostly they are open already: no command per source for the worker on every plot. Asked of each source rather
		// than of openSources(), which still lists the tabs of a browser the user closed until a new one starts
		if (sources.stream().allMatch(imageryBrowser::isOpen)) {
			return;
		}
		try {
			imageryBrowser.openTabs(sources);
		} catch (RuntimeException e) {
			logger.warn("The tabs of the imagery window could not be opened: {}", e.getMessage());
		}
	}

	@FunctionalInterface
	private interface BrowserAction {
		void execute() throws Exception;
	}

	private void openAsync(String windowName, BrowserAction action) {
		async.execute(() -> {
			try {
				action.execute();
			} catch (Exception e) {
				logger.error("Exception opening " + windowName + " window", e);
			}
		});
	}
}
