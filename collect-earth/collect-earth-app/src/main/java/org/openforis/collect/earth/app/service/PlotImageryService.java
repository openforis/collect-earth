package org.openforis.collect.earth.app.service;

import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import javax.annotation.PreDestroy;

import org.openforis.collect.earth.app.service.imagery.ImageryBrowser;
import org.openforis.collect.earth.app.service.imagery.ImagerySource;
import org.openforis.collect.earth.app.service.imagery.TabClosedException;
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

	/** The plot shown last, its sample points and outline filled in; null before the first plot. */
	private final AtomicReference<SimplePlacemarkObject> lastPlacemark = new AtomicReference<>();
	/** Where Google Earth Web was opened before any plot was selected; see {@link #openOverview}. */
	private final AtomicReference<SimplePlacemarkObject> lastOverview = new AtomicReference<>();

	private final ExecutorService executor = Executors.newCachedThreadPool(r -> {
		Thread thread = new Thread(r, "Plot imagery");
		thread.setDaemon(true);
		return thread;
	});

	@PreDestroy
	public void shutdown() {
		executor.shutdownNow();
	}

	/**
	 * Shows the plot in every imagery source switched on, unless it is the plot shown last. Returns once the tabs are
	 * open; the loads of the sources run on threads of their own.
	 */
	public void showPlot(SimplePlacemarkObject placemark, KmlGenerator kmlGenerator) {
		// If this is the first plot or the plot is different from the last one opened
		if (Objects.equals(lastPlacemark.get(), placemark)) {
			return;
		}
		try {
			kmlGenerator.fillSamplePoints(placemark);
			kmlGenerator.fillExternalLine(placemark);
		} catch (TransformException | KmlGenerationException e) {
			logger.error("Error generating polygon", e);
			lastPlacemark.set(placemark);
			return;
		}
		lastPlacemark.set(placemark);
		// Google Earth Web first, so that its load is queued early; on a thread of its own, as it waits for the page and
		// its in-page move. In a browser that starts, its tab is the first whichever comes first, its own load or
		// openImageryTabs(), which opens the tabs one by one in the order of ImagerySource
		showInGoogleEarthWeb(placemark);
		openImageryTabs(false);
		loadInOtherSources(placemark);
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
	 * after; the plot loads in them on threads of their own.
	 *
	 * @return whether a window was asked for
	 */
	public boolean reopenImagery() {
		SimplePlacemarkObject placemark = lastPlacemark.get();
		if (placemark != null) {
			// The tabs first, here: the first command finds the closed window, and opening them starts the new one
			openImageryTabs(true);
			showInGoogleEarthWeb(placemark);
			loadInOtherSources(placemark);
			return true;
		}
		SimplePlacemarkObject overview = lastOverview.get();
		if (overview != null && browserService.enabledImagerySources().contains(ImagerySource.GOOGLE_EARTH_WEB)) {
			executor.submit(() -> googleEarthWebService.openOverview(overview));
			return true;
		}
		return false;
	}

	private void showInGoogleEarthWeb(SimplePlacemarkObject placemark) {
		openAsync("Google Earth Web", () -> googleEarthWebService.showPlot(placemark));
	}

	/** Sends the plot to each source but Google Earth Web, on threads of their own: each waits for its page. */
	private void loadInOtherSources(SimplePlacemarkObject placemark) {
		openAsync("Earth Engine APP", () -> browserService.openGEEAppURL(placemark));
		openAsync("Earth Map", () -> browserService.openEarthMapURL(placemark));
		openAsync("ESRI Wayback", () -> browserService.openEsriWayback(placemark));
		openAsync("Extra Map", () -> browserService.openExtraMap(placemark));
		openAsync("Street View", () -> browserService.openStreetView(placemark));
		openAsync("Planet Maps", () -> browserService.openPlanetMaps(placemark));
		openAsync("SecureWatch", () -> browserService.openSecureWatch(placemark));
	}

	/**
	 * Opens the tabs of the imagery sources switched on before their loads are sent, so that the tabs are in the order of
	 * {@link ImagerySource} whatever order the loads arrive in. When there is no browser, a warning: the loads that
	 * follow fail at once (a failed start is remembered for a while), and the other windows carry on.
	 *
	 * @param windowClosed the window is known to be closed: its tabs still look open (closing the window whole tells
	 *                     nothing until the next command, which fails), so they are opened without asking, and once more
	 *                     after that first failure, in a new browser
	 */
	private void openImageryTabs(boolean windowClosed) {
		Set<ImagerySource> sources = EnumSet.noneOf(ImagerySource.class);
		sources.addAll(browserService.enabledImagerySources());
		if (sources.isEmpty()) {
			return;
		}
		// Mostly they are open already: no command per source for the worker on every plot. Asked of each source rather
		// than of openSources(), which still lists the tabs of a browser the user closed until a new one starts
		if (!windowClosed && sources.stream().allMatch(imageryBrowser::isOpen)) {
			return;
		}
		try {
			try {
				imageryBrowser.openTabs(sources);
			} catch (TabClosedException e) {
				if (!windowClosed) {
					throw e;
				}
				imageryBrowser.openTabs(sources);
			}
		} catch (RuntimeException e) {
			logger.warn("The tabs of the imagery window could not be opened: {}", e.getMessage());
		}
	}

	@FunctionalInterface
	private interface BrowserAction {
		void execute() throws Exception;
	}

	private void openAsync(String windowName, BrowserAction action) {
		executor.submit(() -> {
			try {
				action.execute();
			} catch (Exception e) {
				logger.error("Exception opening " + windowName + " window", e);
			}
		});
	}
}
