package org.openforis.collect.earth.app.service.imagery;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.BiConsumer;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import org.openforis.collect.earth.app.service.BrowserService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.sentry.SentryLevel;

/**
 * The one browser that shows the imagery of the plots, with a tab per {@link ImagerySource}, instead of a browser per
 * source. Every command to it goes through one worker thread (one BiDi connection takes its commands in order).
 * A tab is opened the first time its source has something to show; a tab the user closed is opened again then, and a
 * closed browser is started again.
 * <p>
 * The worker serves the commands of the tab the user is looking at first, then the others in the order they came: a
 * plot change sends work to every tab, and the one on screen should not wait behind the hidden ones. With
 * {@link #loadLatest}, a source that is still loading a plot skips the plots the user went past meanwhile.
 * <p>
 * A command that does not answer in time quits the browser: one hung command would otherwise hold up every tab for
 * good. The next command starts a new browser. Starting the browser is not a hang: it has its own, longer limit
 * ({@link #START_TIMEOUT_SECONDS}), as a cold start on a loaded machine takes about as long as a command may.
 * <p>
 * Faults of Collect Earth met by a command (a script of ours that throws in a page, a BiDi command that fails) are
 * reported here, once per kind and source; a tab or browser the user closed is not a fault.
 */
@Component
public class ImageryBrowser {

	/** Starts the browser; may throw when there is no browser that can be driven. */
	@FunctionalInterface
	public interface Starter {
		TabDriver start() throws Exception;
	}

	/** What the worker does with the tab of a source, the tab opened already. */
	@FunctionalInterface
	interface TabCommand<T> {
		T run(TabDriver driver, String tab) throws Exception;
	}

	/** A command waiting for the worker; the sequence number keeps the order they came in across the sources. */
	private static final class Command<T> {
		final long sequence;
		final ImagerySource source;
		final TabCommand<T> command;
		/** Whether it runs only on a tab that is open already, failing rather than starting a browser or opening one. */
		final boolean ifOpen;
		/** Its own, taken when it was sent: how long it may run before its browser is taken as hung. */
		final long timeoutNanos;
		final long sentNanos = System.nanoTime();
		final CompletableFuture<T> result = new CompletableFuture<>();
		/** The browser the worker runs it on, as soon as it is known: a hang quits only that one. */
		volatile TabDriver runningOn;
		/** Whether its hang was reported and its browser quit, which only one of the callers that see it does. */
		final AtomicBoolean hangHandled = new AtomicBoolean();

		Command(long sequence, ImagerySource source, TabCommand<T> command, boolean ifOpen, long timeoutNanos) {
			this.sequence = sequence;
			this.source = source;
			this.command = command;
			this.ifOpen = ifOpen;
			this.timeoutNanos = timeoutNanos;
		}
	}

	/** The tab of a source and the browser it is in, as one: the browser may be replaced right after. */
	private static final class OpenTab {
		final TabDriver driver;
		final String tab;

		OpenTab(TabDriver driver, String tab) {
			this.driver = driver;
			this.tab = tab;
		}
	}

	/** Long enough for a slow BiDi command, short enough not to leave the caller waiting for a browser that hung. */
	static final long COMMAND_TIMEOUT_SECONDS = 30;
	/**
	 * How long starting the browser may take before the callers give up on it. Firefox took 28 s to start on a loaded
	 * machine, close to {@link #COMMAND_TIMEOUT_SECONDS}: a cold start must not be taken as a hung browser.
	 */
	static final long START_TIMEOUT_SECONDS = 120;
	/** How often a caller waiting for a browser to start looks whether the start is over, to get its own time again. */
	private static final long START_POLL_NANOS = TimeUnit.MILLISECONDS.toNanos(100);
	/** How long {@link #shutdown()} lets the command being run finish before quitting the browser under it. */
	private static final long SHUTDOWN_WAIT_MILLIS = 5000;

	private final Logger logger = LoggerFactory.getLogger(ImageryBrowser.class);

	/** Guards the queues, the sequence and {@link #stopped}; {@link #queued} wakes the worker. */
	private final ReentrantLock queueLock = new ReentrantLock();
	private final Condition queued = queueLock.newCondition();
	private final Map<ImagerySource, ArrayDeque<Command<?>>> queues = new EnumMap<>(ImagerySource.class);
	private long nextSequence;
	private boolean stopped;
	private final Thread worker;

	/** Guards the tab maps below: the worker changes them, the browser's listeners and other threads read them. */
	private final Object tabsLock = new Object();
	private final Map<ImagerySource, String> tabOfSource = new EnumMap<>(ImagerySource.class);
	private final Map<String, ImagerySource> sourceOfTab = new HashMap<>();
	private final List<ImagerySource> openingOrder = new ArrayList<>();
	/** The blank tab the browser opened with, kept so that the event threads do not ask the driver for it. */
	private String initialTab;
	/** Whether {@link #initialTab} still waits for a source. */
	private boolean initialTabFree;
	/**
	 * The tab the classic WebDriver session of {@link #window()} is on, null once it was closed: the session then
	 * points at nothing, and every window command fails until it is switched to a tab that exists.
	 */
	private String classicTab;

	/** The plot each source is to load next, if any; see {@link #loadLatest}. */
	private final Map<ImagerySource, AtomicReference<Runnable>> pendingLoads = new EnumMap<>(ImagerySource.class);
	private final Map<ImagerySource, ReentrantLock> loadLocks = new EnumMap<>(ImagerySource.class);

	private final List<BiConsumer<ImagerySource, Boolean>> visibilityListeners = new CopyOnWriteArrayList<>();
	private final List<Runnable> startListeners = new CopyOnWriteArrayList<>();
	/** Runs the visibility and start listeners, so that they never hold up the thread of the browser's events. */
	private final ExecutorService events = Executors.newSingleThreadExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Imagery browser events");
		thread.setDaemon(true);
		return thread;
	});

	/** Guards the replacement of {@link #driver} by {@link #quitDriver}, which more than one thread may call. */
	private final Object driverLock = new Object();
	private volatile long commandTimeoutMillis = TimeUnit.SECONDS.toMillis(COMMAND_TIMEOUT_SECONDS);
	private volatile long shutdownWaitMillis = SHUTDOWN_WAIT_MILLIS;
	private volatile long startTimeoutNanos = TimeUnit.SECONDS.toNanos(START_TIMEOUT_SECONDS);
	private volatile Starter starter;
	@Autowired
	private volatile ImageryErrorReporter reporter;
	@Autowired
	private BrowserService browserService;
	@Autowired
	private LocalPropertiesService localPropertiesService;
	private volatile TabDriver driver;
	private volatile ImagerySource visible;
	/** What the worker runs now, and since when (set first): a caller that gives up looks here for a hang. */
	private volatile Command<?> running;
	private volatile long runningSinceNanos;
	/**
	 * Whether the worker is starting the browser, and since when (set first): the callers then wait for the start, up
	 * to {@link #startTimeoutNanos}, and nothing is taken as hung. When the start ends, {@link #startEndedNanos} is set
	 * first: the commands that waited for it get their own time again from then.
	 */
	private volatile boolean starting;
	private volatile long startingSinceNanos;
	private volatile long startEndedNanos = System.nanoTime();
	/** The visible state each tab reported last: the listeners hear of changes only, not of every page load. */
	private final Map<String, Boolean> reportedVisibility = new HashMap<>();

	/** For Spring, which sets the starter and the reporter in {@link #init()}. */
	public ImageryBrowser() {
		for (ImagerySource source : ImagerySource.values()) {
			queues.put(source, new ArrayDeque<>());
			pendingLoads.put(source, new AtomicReference<>());
			loadLocks.put(source, new ReentrantLock());
		}
		worker = new Thread(this::work, "Imagery browser");
		worker.setDaemon(true);
		worker.start();
	}

	ImageryBrowser(Starter starter, ImageryErrorReporter reporter) {
		this();
		this.starter = starter;
		this.reporter = reporter;
	}

	/**
	 * Only keeps a reference to the browser service: the two beans refer to each other, and this runs while the other
	 * may still be being set up. The viewer type is set again at every start, as it can change in the options.
	 */
	@PostConstruct
	void init() {
		BrowserService service = browserService;
		starter = () -> {
			reporter.setViewerType(localPropertiesService.getViewerType());
			return service.startImageryBrowser();
		};
		reporter.setViewerType(localPropertiesService.getViewerType());
	}

	void setStarter(Starter starter) {
		this.starter = starter;
	}

	void setStartTimeout(Duration timeout) {
		startTimeoutNanos = timeout.toNanos();
	}

	/** The timeout of the commands sent from now on; one already sent keeps its own. */
	void setCommandTimeout(Duration timeout) {
		commandTimeoutMillis = timeout.toMillis();
	}

	void setShutdownWait(Duration wait) {
		shutdownWaitMillis = wait.toMillis();
	}

	/** The commands waiting for the worker, not counting the one it runs; for the tests. */
	int queuedCount() {
		queueLock.lock();
		try {
			return queues.values().stream().mapToInt(ArrayDeque::size).sum();
		} finally {
			queueLock.unlock();
		}
	}

	public ImageryTab tab(ImagerySource source) {
		return new ImageryTab(this, source);
	}

	/**
	 * Opens the tabs of these sources that are not open yet, in the order of {@link ImagerySource}. One at a time, so
	 * that the visible tab going first cannot change the order of the tab strip.
	 */
	public void openTabs(Collection<ImagerySource> sources) {
		EnumSet<ImagerySource> ordered = EnumSet.noneOf(ImagerySource.class);
		ordered.addAll(sources);
		for (ImagerySource source : ordered) {
			call(source, (d, tab) -> null);
		}
	}

	/**
	 * The sources that have a tab in a browser that is running, in the order their tabs were opened (the tab strip).
	 * Empty once the user closed the window: closing it sends no tab events, so the tabs of that browser are only
	 * forgotten when the next one starts.
	 */
	public List<ImagerySource> openSources() {
		TabDriver d = driver;
		if (d == null || !d.isAlive()) {
			return new ArrayList<>();
		}
		synchronized (tabsLock) {
			return new ArrayList<>(openingOrder);
		}
	}

	/** Whether the source has a tab in a browser that is running; never opens anything. */
	public boolean isOpen(ImagerySource source) {
		TabDriver d = driver;
		if (d == null || !d.isAlive()) {
			return false;
		}
		synchronized (tabsLock) {
			return tabOfSource.containsKey(source);
		}
	}

	/**
	 * The classic WebDriver of the imagery window, to move and size it; null when no browser runs, or when it cannot be
	 * addressed yet (see below).
	 * <p>
	 * Window commands go to the window of the session's current tab, which is the tab the browser opened with until
	 * this switches it. Once the user closed that tab, every command would fail with "no such window", so the session
	 * is switched first to the tab that is visible: in Firefox switching to a tab also selects it, and switching to any
	 * other would bring it to the front under the user. With no visible tab known (the moment after it closed), null:
	 * the window is placed the next time. Whether the current tab is gone is known from the tab events, so this makes
	 * no call to the browser except for that switch (BiDi tab ids are the window handles of the classic session).
	 * <p>
	 * Threads: a {@link RemoteWebDriver} is not safe to use from two threads at once. The worker drives the tabs over
	 * BiDi only, so the classic session is left to the window layout: call this, and use what it returns, only from
	 * WindowLayoutService's code that holds its lock, which keeps the classic calls to one thread at a time.
	 */
	public RemoteWebDriver window() {
		TabDriver d = driver;
		if (d == null || !d.isAlive()) {
			return null;
		}
		RemoteWebDriver window = d.window();
		if (window == null) {
			return null;
		}
		String switchTo;
		synchronized (tabsLock) {
			if (classicTab != null) {
				return window;
			}
			ImagerySource shown = visible;
			switchTo = shown == null ? null : tabOfSource.get(shown);
		}
		if (switchTo == null) {
			logger.debug("Imagery window: its first tab was closed and no tab is known to be shown, not placed now");
			return null;
		}
		try {
			window.switchTo().window(switchTo);
		} catch (WebDriverException e) {
			logger.debug("Imagery window: could not switch the window commands to the tab shown", e);
			return null;
		}
		synchronized (tabsLock) {
			// Unless it closed meanwhile, which forgot it
			if (d == driver && sourceOfTab.containsKey(switchTo)) {
				classicTab = switchTo;
			}
		}
		return window;
	}

	/** The source of the tab shown in the imagery window, or null. */
	public ImagerySource visibleSource() {
		return visible;
	}

	/** Brings the tab of the source to the front, opening it if needed. */
	public void show(ImagerySource source) {
		// Taken as visible at once, so that its commands, this one first, go ahead of the others
		visible = source;
		call(source, (d, tab) -> {
			d.activate(tab);
			// Again once it is in front (a browser started anew meanwhile forgot it); not after the call returns,
			// which could undo a tab the user selected in between
			visible = source;
			return null;
		});
	}

	/**
	 * Called after a browser for the imagery window started, each time one does (the first time, after the user closed
	 * the window, after a hang): a new window, to be laid out. On the thread of the listeners, as
	 * {@link #onVisibilityChange}; the browser may show only its blank first tab yet.
	 */
	public void onBrowserStarted(Runnable listener) {
		startListeners.add(listener);
	}

	/**
	 * Called with a source and whether its tab is now the one shown, when the user selects another tab. Called on a
	 * thread of its own, never the one of the browser's events, which a slow listener would hold up.
	 */
	public void onVisibilityChange(BiConsumer<ImagerySource, Boolean> listener) {
		visibilityListeners.add(listener);
	}

	/**
	 * Runs {@code load} for the source unless a later plot arrives while an earlier one is still loading: then only the
	 * latest runs, once the earlier finished, and the plots in between are skipped. The user going quickly through plots
	 * would otherwise queue a slow page load per plot.
	 * <p>
	 * Runs on the calling thread (the load calls the methods of {@link ImageryTab}, which go through the worker). A call
	 * that finds a load running returns at once, leaving its plot to the thread of that load, which runs the latest plot
	 * when it is done: a request thread does not wait for a page load of another plot. As the thread that runs a load
	 * may not be the one of its plot, a load should handle its own errors; one that escapes reaches that other caller,
	 * after the plots that came meanwhile were loaded.
	 */
	public void loadLatest(ImagerySource source, Runnable load) {
		AtomicReference<Runnable> pending = pendingLoads.get(source);
		ReentrantLock lock = loadLocks.get(source);
		RuntimeException failure = null;
		pending.set(load);
		do {
			if (!lock.tryLock()) {
				break; // the thread loading now loads this plot after
			}
			try {
				Runnable latest = pending.getAndSet(null);
				if (latest != null) {
					latest.run();
				}
			} catch (RuntimeException e) {
				// Kept for later: leaving now would strand a plot that came while this one loaded
				if (failure == null) {
					failure = e;
				}
			} finally {
				lock.unlock();
			}
			// A plot that came after the check above, while the lock was held, would otherwise be left behind
		} while (pending.get() != null);
		if (failure != null) {
			throw failure;
		}
	}

	/** The tab of the source, starting the browser and opening the tab when needed. Called on the worker only. */
	String tabOf(ImagerySource source) throws Exception {
		return open(source, null).tab;
	}

	/**
	 * The tab of the source as it is, for a command sent with {@link #callIfOpen}: {@link TabClosedException} when the
	 * browser is not running or the source has no tab, instead of starting the one or opening the other.
	 */
	private OpenTab existing(ImagerySource source, Command<?> command) {
		TabDriver d = driver;
		command.runningOn = d;
		if (d == null || !d.isAlive()) {
			throw new TabClosedException("The imagery window was closed, for " + source, null);
		}
		synchronized (tabsLock) {
			String tab = tabOfSource.get(source);
			if (tab == null) {
				throw new TabClosedException("The tab of " + source + " was closed", null);
			}
			return new OpenTab(d, tab);
		}
	}

	/** {@code command}, if any, learns the browser it runs on as soon as it is known, as opening a tab can hang too. */
	private OpenTab open(ImagerySource source, Command<?> command) throws Exception {
		TabDriver d = driver;
		if (command != null) {
			command.runningOn = d; // quitting a closed browser can hang as well
		}
		if (d == null || !d.isAlive()) {
			if (d != null) {
				// The user closed the window: its driver service and connection are still there
				quitDriver();
			}
			d = startBrowser();
			if (command != null) {
				command.runningOn = d;
			}
		}
		boolean useInitial;
		String tab;
		synchronized (tabsLock) {
			tab = tabOfSource.get(source);
			if (tab != null) {
				return new OpenTab(d, tab);
			}
			useInitial = initialTabFree;
			initialTabFree = false;
		}
		tab = useInitial ? initialTab : d.createTab();
		synchronized (tabsLock) {
			tabOfSource.put(source, tab);
			sourceOfTab.put(tab, source);
			openingOrder.add(source);
		}
		if (useInitial) {
			visible = source; // the tab the browser opened with is the one shown, and says nothing until that changes
		}
		reporter.breadcrumb(source, "tab opened");
		return new OpenTab(d, tab);
	}

	/** Publishes that the browser is starting while it does, so that the callers wait for it and judge no hang. */
	private TabDriver startBrowser() throws Exception {
		TabDriver d;
		startingSinceNanos = System.nanoTime();
		starting = true;
		try {
			d = starter.start();
		} finally {
			long ended = System.nanoTime();
			startEndedNanos = ended;
			// The command that needed the browser gets its full time from now, as do those behind it
			runningSinceNanos = ended;
			starting = false;
		}
		queueLock.lock();
		try {
			if (stopped) {
				// Shut down while it was starting: nobody else would quit it
				quietlyQuit(d);
				throw new IllegalStateException("The imagery browser was shut down while it started");
			}
		} finally {
			queueLock.unlock();
		}
		synchronized (tabsLock) {
			tabOfSource.clear();
			sourceOfTab.clear();
			openingOrder.clear();
			reportedVisibility.clear();
			initialTab = d.initialTab();
			initialTabFree = true;
			classicTab = initialTab;
		}
		visible = null;
		driver = d;
		d.onTabClosed(tab -> tabClosed(d, tab));
		d.onVisibilityChange((tab, isVisible) -> visibilityChanged(d, tab, isVisible));
		reporter.setBrowser(d.browserName(), d.browserVersion());
		reporter.breadcrumb(null, "browser started");
		tellStarted();
		return d;
	}

	private void tellStarted() {
		if (startListeners.isEmpty()) {
			return;
		}
		try {
			events.execute(() -> {
				for (Runnable listener : startListeners) {
					try {
						listener.run();
					} catch (RuntimeException e) {
						logger.warn("Imagery window: a listener of the browser start failed", e);
					}
				}
			});
		} catch (RejectedExecutionException e) {
			// shut down
		}
	}

	/** The user closed a tab: its source gets a new one the next time it needs it. */
	private void tabClosed(TabDriver from, String tab) {
		if (from != driver) {
			return; // a late event of a browser that was replaced
		}
		synchronized (tabsLock) {
			if (tab.equals(initialTab)) {
				initialTabFree = false;
			}
			forget(tab);
		}
	}

	/** Kept here at once, as {@link #visibleSource()} is read right after; the listeners are told on their thread. */
	private void visibilityChanged(TabDriver from, String tab, boolean isVisible) {
		if (from != driver) {
			return;
		}
		ImagerySource source;
		boolean changed;
		synchronized (tabsLock) {
			source = sourceOfTab.get(tab);
			// The preload script reports on every page load as well, mostly the same as before
			changed = source != null && !Boolean.valueOf(isVisible).equals(reportedVisibility.put(tab, isVisible));
		}
		if (source == null) {
			return; // a tab that is not ours
		}
		if (isVisible) {
			visible = source;
		} else if (visible == source) {
			visible = null;
		}
		if (!changed || visibilityListeners.isEmpty()) {
			return;
		}
		try {
			events.execute(() -> {
				for (BiConsumer<ImagerySource, Boolean> listener : visibilityListeners) {
					try {
						listener.accept(source, isVisible);
					} catch (RuntimeException e) {
						logger.warn("Imagery window: a listener of the visible tab failed", e);
					}
				}
			});
		} catch (RejectedExecutionException e) {
			// shut down
		}
	}

	/** Called holding {@link #tabsLock}. */
	private void forget(String tab) {
		if (tab.equals(classicTab)) {
			classicTab = null;
		}
		reportedVisibility.remove(tab);
		ImagerySource source = sourceOfTab.remove(tab);
		if (source != null) {
			tabOfSource.remove(source);
			openingOrder.remove(source);
			if (visible == source) {
				visible = null;
			}
		}
	}

	/**
	 * Runs the command on the tab of the source, on the worker, and waits for its result. A tab found closed is forgotten,
	 * so the next command of its source opens it again, and the {@link TabClosedException} reaches the caller as it is.
	 * Runtime exceptions reach the caller as they are; a checked one (no browser to start, mostly) wrapped in an
	 * {@link IllegalStateException}.
	 * <p>
	 * Each command has its own timeout, the one set when it was sent. A caller that runs out of time looks at what the
	 * worker is doing, whichever command that is: one that has run for longer than its own timeout means a hung
	 * browser, which is reported and quit (once, by whichever caller sees it first), and that fails the command stuck in
	 * it; the next command starts a new browser. A worker that is merely busy is left alone, and the caller only gives
	 * up: quitting then could end a healthy browser. A command that started late, behind others, gets its full time to
	 * run before it is taken as hung.
	 * <p>
	 * While the worker starts the browser, the callers wait for it up to {@link #START_TIMEOUT_SECONDS} from the
	 * beginning of the start, and get their own time again once it is over. A start that takes longer fails them and is
	 * reported, but is not taken as a hang: there is no browser to quit yet.
	 */
	<T> T call(ImagerySource source, TabCommand<T> command) {
		return call(source, command, false);
	}

	/**
	 * Like {@link #call}, but only on a tab that is open already: with no browser running, or no tab of the source, it
	 * throws {@link TabClosedException} instead of starting a browser or opening a tab. For the checks that look
	 * whether a tab is still there, which would otherwise bring up a new window with a blank tab when it is not.
	 */
	<T> T callIfOpen(ImagerySource source, TabCommand<T> command) {
		if (!isOpen(source)) {
			// Known without the worker, so a check of a closed window does not wait behind the commands of the others
			throw new TabClosedException("The tab of " + source + " is not open", null);
		}
		return call(source, command, true);
	}

	private <T> T call(ImagerySource source, TabCommand<T> command, boolean ifOpen) {
		if (Thread.currentThread() == worker) {
			throw new IllegalStateException("A command of the imagery browser sent from its own worker would wait forever");
		}
		Command<T> queuedCommand = enqueue(source, command, ifOpen, TimeUnit.MILLISECONDS.toNanos(commandTimeoutMillis));
		try {
			try {
				try {
					return await(queuedCommand);
				} catch (TimeoutException e) {
					// given up below
				}
				if (!queuedCommand.result.cancel(false)) {
					return queuedCommand.result.get(); // it answered just now
				}
				drop(queuedCommand);
				long now = System.nanoTime();
				if (starting) {
					long startingFor = now - startingSinceNanos;
					if (startingFor >= startTimeoutNanos) {
						throw slowStart(source, startingFor);
					}
				} else {
					Command<?> current = running;
					long runningFor = now - runningSinceNanos;
					if (current != null && runningFor >= current.timeoutNanos) {
						throw hang(current);
					}
				}
				throw new IllegalStateException("The imagery browser was busy for "
						+ TimeUnit.NANOSECONDS.toMillis(now - queuedCommand.sentNanos) + " ms with other commands, for "
						+ source);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				if (!queuedCommand.result.cancel(false)) {
					return queuedCommand.result.get(); // it answered just now; a done future does not wait
				}
				drop(queuedCommand);
				throw new IllegalStateException("Interrupted waiting for the imagery browser, for " + source, e);
			}
		} catch (ExecutionException e) {
			throw unchecked(e.getCause());
		} catch (InterruptedException e) {
			// Not reached: get() of a completed future does not wait, even interrupted
			Thread.currentThread().interrupt();
			throw new IllegalStateException(e);
		}
	}

	/**
	 * Waits for the result of the command for as long as it is entitled to, and throws {@link TimeoutException} once it
	 * is not: its own timeout from when it was sent, or from the end of the last start of the browser if that came
	 * later, or from when it began to run if it is running (it started late, behind others); and while the browser is
	 * starting, until the limit of the start.
	 */
	private <T> T await(Command<T> command) throws InterruptedException, ExecutionException, TimeoutException {
		while (true) {
			long now = System.nanoTime();
			long until;
			if (starting) {
				until = startingSinceNanos + startTimeoutNanos;
				if (now - until >= 0) {
					throw new TimeoutException();
				}
				// Looks again soon: once the start is over, the command has its own time, not what is left of the start's
				if (until - now > START_POLL_NANOS) {
					until = now + START_POLL_NANOS;
				}
			} else {
				until = later(command.sentNanos, startEndedNanos) + command.timeoutNanos;
				if (running == command) {
					until = later(until, runningSinceNanos + command.timeoutNanos);
				}
				if (now - until >= 0) {
					throw new TimeoutException();
				}
			}
			try {
				return command.result.get(until - now, TimeUnit.NANOSECONDS);
			} catch (TimeoutException e) {
				// looked at again
			}
		}
	}

	/** The later of two {@link System#nanoTime()} values, which may overflow. */
	private static long later(long a, long b) {
		return a - b >= 0 ? a : b;
	}

	/** A start of the browser that went over its limit: reported, as a warning, and there is nothing to quit yet. */
	private IllegalStateException slowStart(ImagerySource source, long startingForNanos) {
		IllegalStateException slow = new IllegalStateException("The imagery browser did not start in "
				+ TimeUnit.NANOSECONDS.toMillis(startingForNanos) + " ms, for " + source);
		reporter.report(null, "browser_start_slow", slow, SentryLevel.WARNING);
		return slow;
	}

	/** Reports the hang of the browser the command is stuck in and quits it, unless another caller did already. */
	private IllegalStateException hang(Command<?> stuck) {
		IllegalStateException hung = new IllegalStateException("The imagery browser did not answer in "
				+ TimeUnit.NANOSECONDS.toMillis(stuck.timeoutNanos) + " ms, for " + stuck.source);
		if (stuck.hangHandled.compareAndSet(false, true)) {
			reporter.report(stuck.source, "command_timeout", hung);
			TabDriver d = stuck.runningOn;
			if (d != null) {
				quitDriver(d);
			}
		}
		return hung;
	}

	private <T> Command<T> enqueue(ImagerySource source, TabCommand<T> command, boolean ifOpen, long timeoutNanos) {
		queueLock.lock();
		try {
			if (stopped) {
				throw new IllegalStateException("The imagery browser was shut down");
			}
			Command<T> queuedCommand = new Command<>(nextSequence++, source, command, ifOpen, timeoutNanos);
			queues.get(source).add(queuedCommand);
			queued.signal();
			return queuedCommand;
		} finally {
			queueLock.unlock();
		}
	}

	/** Takes out a command its caller gave up on, if it still waits, so that such commands do not pile up. */
	private void drop(Command<?> queuedCommand) {
		queueLock.lock();
		try {
			queues.get(queuedCommand.source).remove(queuedCommand);
		} finally {
			queueLock.unlock();
		}
	}

	/** The loop of the worker, until shut down; it quits the browser on its way out, as the thread that drives it. */
	private void work() {
		try {
			while (true) {
				Command<?> next;
				try {
					next = take();
				} catch (InterruptedException e) {
					continue; // only shutdown() stops the worker
				}
				if (next == null) {
					return;
				}
				execute(next);
			}
		} finally {
			quitDriver();
		}
	}

	/** The next command, waiting for one; null once shut down. */
	private Command<?> take() throws InterruptedException {
		queueLock.lock();
		try {
			while (true) {
				if (stopped) {
					return null;
				}
				Command<?> next = poll();
				if (next != null) {
					return next;
				}
				queued.await();
			}
		} finally {
			queueLock.unlock();
		}
	}

	/** The first command of the visible source, else the oldest of all. Called holding {@link #queueLock}. */
	private Command<?> poll() {
		ImagerySource shown = visible;
		if (shown != null) {
			Command<?> next = queues.get(shown).poll();
			if (next != null) {
				return next;
			}
		}
		Command<?> oldest = null;
		for (ArrayDeque<Command<?>> queue : queues.values()) {
			Command<?> first = queue.peek();
			if (first != null && (oldest == null || first.sequence < oldest.sequence)) {
				oldest = first;
			}
		}
		if (oldest != null) {
			queues.get(oldest.source).poll();
		}
		return oldest;
	}

	private <T> void execute(Command<T> queuedCommand) {
		if (queuedCommand.result.isDone()) {
			return; // its caller gave up waiting
		}
		runningSinceNanos = System.nanoTime();
		running = queuedCommand;
		OpenTab open = null;
		try {
			// Checked again here: the browser may have closed while the command waited
			open = queuedCommand.ifOpen ? existing(queuedCommand.source, queuedCommand)
					: open(queuedCommand.source, queuedCommand);
			if (queuedCommand.result.isDone()) {
				return; // its caller gave up while the tab opened
			}
			queuedCommand.result.complete(queuedCommand.command.run(open.driver, open.tab));
		} catch (TabClosedException e) {
			if (open != null) {
				synchronized (tabsLock) {
					forget(open.tab);
				}
			}
			// The user closed it: not a fault
			logger.warn("Imagery window, {}: {}", queuedCommand.source, e.getMessage());
			reporter.breadcrumb(queuedCommand.source, "tab closed");
			queuedCommand.result.completeExceptionally(e);
		} catch (PageScriptException e) {
			if (!e.isDocumentReplaced()) {
				reporter.report(queuedCommand.source, "page_script", e);
			}
			queuedCommand.result.completeExceptionally(e);
		} catch (BidiCommandException e) {
			reporter.report(queuedCommand.source, "bidi_command", e);
			queuedCommand.result.completeExceptionally(e);
		} catch (Throwable e) { // NOSONAR the worker must survive whatever a command throws
			queuedCommand.result.completeExceptionally(e);
		} finally {
			running = null;
		}
	}

	private static RuntimeException unchecked(Throwable cause) {
		if (cause instanceof RuntimeException) {
			return (RuntimeException) cause;
		}
		if (cause instanceof Error) {
			throw (Error) cause;
		}
		return new IllegalStateException(String.valueOf(cause.getMessage()), cause);
	}

	/** Quits the browser, if there is one, once even when several threads ask; the next command starts a new one. */
	private void quitDriver() {
		TabDriver d;
		synchronized (driverLock) {
			d = driver;
			driver = null;
		}
		if (d != null) {
			quietlyQuit(d);
		}
	}

	/** Quits this browser, and forgets it if it is still the current one (not if a new one replaced it meanwhile). */
	private void quitDriver(TabDriver stuck) {
		synchronized (driverLock) {
			if (driver == stuck) {
				driver = null;
			}
		}
		quietlyQuit(stuck);
	}

	private void quietlyQuit(TabDriver d) {
		try {
			d.quit();
		} catch (RuntimeException e) {
			logger.warn("Imagery window: the browser did not quit", e);
		}
	}

	/**
	 * Fails the commands still waiting and stops the worker, which quits the browser on its way out. When the command
	 * being run does not finish in a few seconds, the browser is quit from here, which fails that command.
	 */
	@PreDestroy
	public void shutdown() {
		List<Command<?>> abandoned = new ArrayList<>();
		queueLock.lock();
		try {
			if (stopped) {
				return;
			}
			stopped = true;
			for (ArrayDeque<Command<?>> queue : queues.values()) {
				abandoned.addAll(queue);
				queue.clear();
			}
			queued.signalAll();
		} finally {
			queueLock.unlock();
		}
		IllegalStateException shutDown = new IllegalStateException("The imagery browser was shut down");
		abandoned.forEach(command -> command.result.completeExceptionally(shutDown));
		try {
			worker.join(shutdownWaitMillis);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
		if (worker.isAlive()) {
			quitDriver(); // the worker is stuck in a command; a browser it is still starting, it quits itself
		}
		events.shutdownNow();
	}
}
