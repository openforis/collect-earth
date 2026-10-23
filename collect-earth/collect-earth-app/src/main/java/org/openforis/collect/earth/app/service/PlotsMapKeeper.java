package org.openforis.collect.earth.app.service;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Keeps the plots map window open while Collect Earth runs: the window holds the data entry form, and closed it leaves
 * the user no way to fill in a plot, nor to know how to get it back (only a Tools menu item of the main window did). A
 * browser window cannot refuse to close, so it is opened again soon after, and laid out again where it was. When and
 * when not is decided by {@link PlotsMapReopening}.
 * <p>
 * Watched from the moment the plots map first opens ({@link BrowserService#onLeafletMapOpened}), every
 * {@link #CHECK_PERIOD_SECONDS} seconds, with a {@code getWindowHandles()} to its browser (see
 * {@link WindowLayoutService#plotsMapWindow()}): a cheap call, which does not touch the page. Reopened only once two
 * checks in a row found it closed, as reopening a window that is in fact there reloads the form in it. "Arrange"
 * reopens it too, at once.
 */
@Component
public class PlotsMapKeeper {

	private static final long CHECK_PERIOD_SECONDS = 2;

	private final Logger logger = LoggerFactory.getLogger(PlotsMapKeeper.class);

	@Autowired
	private BrowserService browserService;

	@Autowired
	private WindowLayoutService windowLayoutService;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	@Autowired
	private PlotImageryService plotImageryService;

	private final PlotsMapReopening reopening = new PlotsMapReopening();
	private ScheduledExecutorService watcher;
	private boolean stopped;

	@PostConstruct
	void listen() {
		browserService.onLeafletMapOpened(this::opened);
	}

	/** The plots map opened, by whoever (start, Tools menu, Arrange, this): kept open from now on. */
	private synchronized void opened() {
		reopening.opened();
		if (watcher != null || stopped) {
			return;
		}
		watcher = Executors.newSingleThreadScheduledExecutor(r -> {
			Thread thread = new Thread(r, "Plots map keeper");
			thread.setDaemon(true);
			return thread;
		});
		// With a fixed delay, a check that waits for a browser (or a reopen that takes seconds) never piles up with the
		// next one
		watcher.scheduleWithFixedDelay(this::check, CHECK_PERIOD_SECONDS, CHECK_PERIOD_SECONDS, TimeUnit.SECONDS);
	}

	private void check() {
		try {
			if (!reopening.shouldCheck(localPropertiesService.isPlotsMapViewer(), browserService.isClosing())) {
				return;
			}
			if (windowLayoutService.plotsMapWindow() != WindowLayoutService.WindowState.CLOSED) {
				reopening.foundOpen();
				return;
			}
			if (!reopening.foundClosed()) {
				return; // once more at the next check
			}
			logger.info("The plots map window was closed, opening it again: it holds the form");
			boolean open;
			try {
				// On the plot that was open: the form comes back where the user was
				open = browserService.reopenLeafletMap(plotImageryService.getSelectedPlotId());
			} catch (BrowserNotFoundException | RuntimeException e) {
				if (reopening.failed()) {
					logger.warn("The plots map window could not be opened again, trying again in {} s: {}",
							PlotsMapReopening.BACK_OFF.getSeconds(), e.getMessage());
				}
				return;
			}
			if (!open) {
				// Collect Earth started closing meanwhile, or the browser could not be driven (logged where it failed)
				if (!browserService.isClosing() && reopening.failed()) {
					logger.warn("The plots map window could not be opened again, trying again in {} s",
							PlotsMapReopening.BACK_OFF.getSeconds());
				}
				return;
			}
			windowLayoutService.arrange();
		} catch (RuntimeException e) {
			// A scheduled task that throws is never run again: the window would stay closed for good
			logger.warn("Could not check whether the plots map window is open", e);
		}
	}

	@PreDestroy
	public synchronized void stop() {
		stopped = true;
		if (watcher != null) {
			watcher.shutdownNow();
		}
	}
}
