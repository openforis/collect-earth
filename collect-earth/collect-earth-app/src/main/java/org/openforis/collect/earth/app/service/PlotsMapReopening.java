package org.openforis.collect.earth.app.service;

import java.time.Duration;
import java.util.function.LongSupplier;

/**
 * When {@link PlotsMapKeeper} looks whether the plots map window is still open, and reopens it: the decision, without
 * the windows, so that it can be tested.
 * <p>
 * The plots map holds the data entry form: closed, it leaves the user no way to fill in a plot. A browser window cannot
 * refuse to close, so it is opened again - but only once it was opened at all (the classic viewer never opens it),
 * while it is the viewer, and not while Collect Earth closes its browsers. When the browser cannot start, a reopen
 * every check would start the whole search for a browser every two seconds and flood the log: after a failed reopen
 * the window is left alone for {@link #BACK_OFF}, and only the first failure in a row is worth a warning.
 */
final class PlotsMapReopening {

	/** Long enough not to search for a browser over and over; short enough to come back soon once one can start. */
	static final Duration BACK_OFF = Duration.ofSeconds(30);

	private final LongSupplier clock;
	private final long backOffNanos;
	private boolean opened;
	/** The checks in a row that found the window closed; see {@link #foundClosed()}. */
	private int closedInARow;
	private boolean failed;
	/** When the last reopen failed, as {@link #clock} gives it; valid when {@link #failed} is set. */
	private long failedAt;

	PlotsMapReopening() {
		this(System::nanoTime, BACK_OFF);
	}

	PlotsMapReopening(LongSupplier nanoClock, Duration backOff) {
		this.clock = nanoClock;
		this.backOffNanos = backOff.toNanos();
	}

	/** The plots map window opened (the first time, or again): it is kept open from now on, and works again. */
	synchronized void opened() {
		opened = true;
		failed = false;
		closedInARow = 0;
	}

	/**
	 * A check found the window closed. Returns whether to reopen it: only the second check in a row that finds it so.
	 * Reopening loads the plots map again, in the window if it is in fact still there, and the form loses what was
	 * typed in it: one odd answer of a browser is not enough for that.
	 */
	synchronized boolean foundClosed() {
		return ++closedInARow >= 2;
	}

	/** A check found the window open, or got no clear answer: the count of {@link #foundClosed()} starts again. */
	synchronized void foundOpen() {
		closedInARow = 0;
	}

	/**
	 * Whether to look at the window now (a call to its browser), and to reopen it if it is closed.
	 *
	 * @param plotsMapViewer whether the plot viewer is the plots map (with or without Google Earth Web)
	 * @param closing        whether Collect Earth is closing its browsers
	 */
	synchronized boolean shouldCheck(boolean plotsMapViewer, boolean closing) {
		return opened && plotsMapViewer && !closing && !(failed && clock.getAsLong() - failedAt < backOffNanos);
	}

	/**
	 * A reopen did not give a window. Returns whether to warn about it: only the first failure in a row, the next ones
	 * being the same browser that still cannot start.
	 */
	synchronized boolean failed() {
		boolean first = !failed;
		failed = true;
		failedAt = clock.getAsLong();
		return first;
	}
}
