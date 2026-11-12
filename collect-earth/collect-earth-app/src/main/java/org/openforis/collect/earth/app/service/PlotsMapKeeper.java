package org.openforis.collect.earth.app.service;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import java.awt.GraphicsEnvironment;
import java.util.concurrent.atomic.AtomicReference;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import javax.swing.JDialog;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

/**
 * Keeps Google Earth Web's window open while Collect Earth runs: the plots map in its panel holds the data entry form,
 * and closed it leaves the user no way to fill in a plot, nor to know how to get it back. A browser window cannot refuse
 * to close, so it is opened again soon after, and laid out again where it was. When and when not is decided by
 * {@link PlotsMapReopening}.
 * <p>
 * Watched from the moment the plots map first opens ({@link BrowserService#onLeafletMapOpened}), every
 * {@link #CHECK_PERIOD_SECONDS} seconds, from what Google Earth Web knows of its tab, and opened again through
 * {@link BrowserService#reopenLeafletMap}. Reopened only once two checks in a row found it closed, as reopening a window
 * that is in fact there reloads the form in it. "Arrange" reopens it too, at once.
 * <p>
 * Before reopening it, the user is asked whether they meant to quit ({@link ClosedWindowQuestion}): closing the main
 * window is how one quits most programs, and Collect Earth used to bring it back without a word, which left the icon in
 * the system tray as the only way out that people found.
 */
// Not lazy: the application context creates its beans lazily (applicationContext.fmt), and nothing asks for this one,
// which only listens for the plots map to open
@Component
@Lazy(false)
public class PlotsMapKeeper {

	private static final long CHECK_PERIOD_SECONDS = 2;

	private final Logger logger = LoggerFactory.getLogger(PlotsMapKeeper.class);

	@Autowired
	private BrowserService browserService;

	@Autowired
	private WindowLayoutService windowLayoutService;

	@Autowired
	private GoogleEarthWebService googleEarthWebService;

	@Autowired
	private QuitService quitService;

	/** What the user wants when they close the main window: to quit Collect Earth, or to have the window back. */
	enum ClosedWindowAnswer {
		QUIT, REOPEN
	}

	/** Asks it; a dialog on the screen, something else in the tests. */
	interface ClosedWindowQuestion {
		ClosedWindowAnswer ask();
	}

	private ClosedWindowQuestion question = PlotsMapKeeper::askInADialog;

	private final PlotsMapReopening reopening = new PlotsMapReopening();
	private ScheduledExecutorService watcher;
	private volatile boolean stopped;

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
			if (!reopening.shouldCheck(browserService.isClosing())) {
				return;
			}
			if (!googleEarthWebService.isClosed()) {
				reopening.foundOpen();
				return;
			}
			if (!reopening.foundClosed()) {
				return; // once more at the next check
			}
			ClosedWindowAnswer answer = question.ask();
			if (stopped || browserService.isClosing()) {
				return; // Collect Earth restarted or quit while the question was on the screen
			}
			if (answer == ClosedWindowAnswer.QUIT) {
				logger.info("The main window was closed and the user chose to quit Collect Earth");
				quitService.run();
				return;
			}
			// The answer took a while: the window may be back meanwhile (the tray icon, Arrange), and reopening it then
			// would load the form again
			if (!googleEarthWebService.isClosed()) {
				reopening.foundOpen();
				return;
			}
			logger.info("The Google Earth Web window was closed, opening it again: it holds the form");
			boolean open;
			try {
				// On the plot shown last
				open = browserService.reopenLeafletMap();
			} catch (RuntimeException e) {
				if (reopening.failed()) {
					logger.warn("The Google Earth Web window could not be opened again, trying again in {} s: {}",
							PlotsMapReopening.BACK_OFF.getSeconds(), e.getMessage());
				}
				return;
			}
			if (!open) {
				// Collect Earth started closing meanwhile, or the browser could not be driven (logged where it failed)
				if (!browserService.isClosing() && reopening.failed()) {
					logger.warn("The Google Earth Web window could not be opened again, trying again in {} s",
							PlotsMapReopening.BACK_OFF.getSeconds());
				}
				return;
			}
			windowLayoutService.arrange();
		} catch (RuntimeException e) {
			// A scheduled task that throws is never run again: the window would stay closed for good
			logger.warn("Could not check whether the Google Earth Web window is open", e);
		}
	}

	/**
	 * The question, on the Swing thread, in front of every window (the browsers' included), and waited for: the check
	 * that found the window closed runs again only once it is answered. Without a screen, the window is reopened.
	 */
	static ClosedWindowAnswer askInADialog() {
		if (GraphicsEnvironment.isHeadless()) {
			return ClosedWindowAnswer.REOPEN;
		}
		AtomicReference<ClosedWindowAnswer> answer = new AtomicReference<>(ClosedWindowAnswer.REOPEN);
		try {
			SwingUtilities.invokeAndWait(() -> {
				String reopen = Messages.getString("WindowClosed.reopen"); //$NON-NLS-1$
				String quit = Messages.getString("WindowClosed.quit"); //$NON-NLS-1$
				JOptionPane pane = new JOptionPane(Messages.getString("WindowClosed.message"), JOptionPane.QUESTION_MESSAGE, //$NON-NLS-1$
						JOptionPane.DEFAULT_OPTION, null, new Object[] { reopen, quit }, reopen);
				JDialog dialog = pane.createDialog(null, Messages.getString("WindowClosed.title")); //$NON-NLS-1$
				dialog.setAlwaysOnTop(true);
				dialog.setVisible(true);
				dialog.toFront();
				dialog.dispose();
				// Closing the dialog itself keeps Collect Earth, as the button that reopens the window does
				answer.set(quit.equals(pane.getValue()) ? ClosedWindowAnswer.QUIT : ClosedWindowAnswer.REOPEN);
			});
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		} catch (Exception e) {
			LoggerFactory.getLogger(PlotsMapKeeper.class).warn("Could not ask whether to quit Collect Earth", e);
		}
		return answer.get();
	}

	/** For the tests. */
	void setQuestion(ClosedWindowQuestion question) {
		this.question = question;
	}

	@PreDestroy
	public synchronized void stop() {
		stopped = true;
		if (watcher != null) {
			watcher.shutdownNow();
		}
	}
}
