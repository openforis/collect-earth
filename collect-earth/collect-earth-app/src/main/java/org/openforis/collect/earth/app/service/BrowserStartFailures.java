package org.openforis.collect.earth.app.service;

import java.time.Duration;
import java.util.Locale;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

import org.openqa.selenium.remote.NoSuchDriverException;

/**
 * What {@link BrowserService#startImageryBrowser()} remembers of a start that failed, and how it reads a browser that
 * did not start.
 * <p>
 * Every plot sends work to each imagery tab, and each needs the browser. When no browser can start, each of them would
 * go through the whole search again (three browsers, each with its profile and then without), which takes long enough
 * to be felt on every plot change. A failed start is therefore remembered for a while ({@link #RETRY_AFTER}), and the
 * starts asked for meanwhile fail at once.
 */
final class BrowserStartFailures {

	/** Long enough for a few plot changes not to start a search each; short enough to notice a browser just installed. */
	static final Duration RETRY_AFTER = Duration.ofMinutes(1);

	/**
	 * What the drivers say when the browser, or the driver itself, is not there: chromedriver "cannot find Chrome
	 * binary" / "no chrome binary at", msedgedriver the same with msedge, geckodriver "unable to find binary in default
	 * location", "binary is not a Firefox executable", Selenium Manager "Unable to obtain: ...".
	 */
	private static final Pattern NOT_INSTALLED = Pattern.compile(
			"cannot find \\S+ binary|no \\S+ binary|unable to find binary|not a firefox executable|unable to obtain");

	private final LongSupplier clock;
	private final long retryAfterNanos;
	/** When the last start failed, as {@link #clock} gives it; valid when {@link #failed} is set. */
	private volatile long failedAt;
	private volatile boolean failed;

	BrowserStartFailures() {
		this(System::nanoTime, RETRY_AFTER);
	}

	BrowserStartFailures(LongSupplier nanoClock, Duration retryAfter) {
		this.clock = nanoClock;
		this.retryAfterNanos = retryAfter.toNanos();
	}

	/** No browser could start. */
	void failed() {
		failedAt = clock.getAsLong();
		failed = true;
	}

	/** A browser started: whatever failed before is over. */
	void started() {
		failed = false;
	}

	/** Whether a start failed less than {@link #RETRY_AFTER} ago, so that trying again now would fail the same way. */
	boolean failedRecently() {
		return failed && clock.getAsLong() - failedAt < retryAfterNanos;
	}

	/**
	 * Whether the browser could not start because it, or its driver, is not installed: then starting it again without
	 * its profile cannot help. Read from the exception, as the drivers have no type of their own for it: Selenium's
	 * {@link NoSuchDriverException}, or the messages of the drivers (see {@link #NOT_INSTALLED}). Anything else (a
	 * profile in use, a browser that exits at once, a message not known here) may be about the profile, and gets the
	 * start without it.
	 */
	static boolean isNotInstalled(Throwable failure) {
		for (Throwable t = failure; t != null; t = t.getCause()) {
			if (t instanceof NoSuchDriverException) {
				return true;
			}
			String message = t.getMessage();
			if (message != null && NOT_INSTALLED.matcher(message.toLowerCase(Locale.ROOT)).find()) {
				return true;
			}
		}
		return false;
	}
}
