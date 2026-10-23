package org.openforis.collect.earth.app.service;

import java.time.Duration;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.openforis.collect.earth.app.service.WindowLayoutService.WindowState;

/**
 * Asks a browser whether its window is there without waiting for it longer than a timeout: a hung browser
 * answers a WebDriver call only when Selenium gives up on it, after 3 minutes, and the layout of the windows, the
 * imagery source buttons and "Arrange" would wait as long. The call runs on a thread of its own; one not answered in
 * time is {@link WindowState#NO_ANSWER}, and while it still waits the next checks are NO_ANSWER at once, so that the
 * threads do not pile up on a hung browser. One per window, so that a hung one does not hold up the check of the other.
 */
final class WindowProbe {

	private final ExecutorService executor;
	private final long timeoutNanos;
	/** The check sent last; guarded by this. */
	private Future<WindowState> pending;

	WindowProbe(String threadName, Duration timeout) {
		this.timeoutNanos = timeout.toNanos();
		this.executor = Executors.newSingleThreadExecutor(r -> {
			Thread thread = new Thread(r, threadName);
			thread.setDaemon(true);
			return thread;
		});
	}

	/** Runs the check, waiting for it at most the timeout; NO_ANSWER if it fails or takes longer. */
	WindowState check(Callable<WindowState> call) {
		Future<WindowState> check;
		synchronized (this) {
			if (pending != null && !pending.isDone()) {
				return WindowState.NO_ANSWER; // the one before still waits for the browser
			}
			try {
				pending = executor.submit(call);
			} catch (RejectedExecutionException e) {
				return WindowState.NO_ANSWER; // shut down
			}
			check = pending;
		}
		try {
			return check.get(timeoutNanos, TimeUnit.NANOSECONDS);
		} catch (TimeoutException | ExecutionException e) {
			return WindowState.NO_ANSWER;
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			return WindowState.NO_ANSWER;
		}
	}

	void shutdown() {
		executor.shutdownNow();
	}
}
