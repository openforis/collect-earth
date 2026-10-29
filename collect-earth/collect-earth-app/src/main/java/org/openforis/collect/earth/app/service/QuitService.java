package org.openforis.collect.earth.app.service;

import java.util.concurrent.atomic.AtomicBoolean;

import org.openforis.collect.earth.app.desktop.EarthApp;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Quits Collect Earth, from the pages (POST /api/actions/quit) or the Swing window: the server first, for at most 5 s,
 * then the process. That is all the window did on closing; the browsers, Saiku and the SQLite backup are closed by
 * their own shutdown hooks and by the closing of the Spring context, which stopping the server does.
 * <p>
 * run() returns at once and the quitting goes on in a thread of its own, so the HTTP request that asked for it is
 * answered first. A second call while quitting does nothing.
 */
@Service
public class QuitService implements Runnable {

	private static final long SERVER_STOP_MILLIS = 5000;
	private final Logger logger = LoggerFactory.getLogger(QuitService.class);

	private final Runnable stopServer;
	private final Runnable exit;
	private final long serverStopMillis;
	private final AtomicBoolean quitting = new AtomicBoolean();

	public QuitService() {
		this(EarthApp::quitServer, () -> System.exit(0), SERVER_STOP_MILLIS);
	}

	/** For the tests, which cannot let the process exit. */
	QuitService(Runnable stopServer, Runnable exit, long serverStopMillis) {
		this.stopServer = stopServer;
		this.exit = exit;
		this.serverStopMillis = serverStopMillis;
	}

	@Override
	public void run() {
		if (!quitting.compareAndSet(false, true)) {
			return;
		}
		new Thread(() -> {
			Thread stop = new Thread(() -> {
				try {
					stopServer.run();
				} catch (RuntimeException e) {
					logger.error("Error when stopping the server", e);
				}
			}, "Stopping server");
			stop.start();
			try {
				// The process exits whether the server has stopped or not: a server that hangs must not keep Collect
				// Earth running after the user asked it to quit
				stop.join(serverStopMillis);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
			exit.run();
		}, "Quitting Collect Earth").start();
	}
}
