package org.openforis.collect.earth.app.service.imagery;

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
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.BiConsumer;

import javax.annotation.PreDestroy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The one browser that shows the imagery of the plots, with a tab per {@link ImagerySource}, instead of a browser per
 * source. Every command to it goes through one worker thread (one BiDi connection takes its commands in order).
 * A tab is opened the first time its source has something to show; a tab the user closed is opened again then, and a
 * closed browser is started again.
 * <p>
 * The worker serves the commands of the tab the user is looking at first, then the others in the order they came: a
 * plot change sends work to every tab, and the one on screen should not wait behind the hidden ones. With
 * {@link #loadLatest}, a source that is still loading a plot skips the plots the user went past meanwhile.
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
		final CompletableFuture<T> result = new CompletableFuture<>();

		Command(long sequence, ImagerySource source, TabCommand<T> command) {
			this.sequence = sequence;
			this.source = source;
			this.command = command;
		}
	}

	/** Long enough for a slow BiDi command, short enough not to leave the caller waiting for a browser that hung. */
	static final long COMMAND_TIMEOUT_SECONDS = 30;
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
	/** Whether the blank tab the browser opened with still waits for a source. */
	private boolean initialTabFree;

	/** The plot each source is to load next, if any; see {@link #loadLatest}. */
	private final Map<ImagerySource, AtomicReference<Runnable>> pendingLoads = new EnumMap<>(ImagerySource.class);
	private final Map<ImagerySource, Object> loadLocks = new EnumMap<>(ImagerySource.class);

	private final List<BiConsumer<ImagerySource, Boolean>> visibilityListeners = new CopyOnWriteArrayList<>();
	/** Runs the visibility listeners, so that they never hold up the thread of the browser's events. */
	private final ExecutorService events = Executors.newSingleThreadExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Imagery browser events");
		thread.setDaemon(true);
		return thread;
	});

	private volatile Starter starter;
	private volatile ImageryErrorReporter reporter;
	private volatile TabDriver driver;
	private volatile ImagerySource visible;

	/** For Spring: the starter and the reporter are set in {@code @PostConstruct} (a later task). */
	public ImageryBrowser() {
		for (ImagerySource source : ImagerySource.values()) {
			queues.put(source, new ArrayDeque<>());
			pendingLoads.put(source, new AtomicReference<>());
			loadLocks.put(source, new Object());
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

	void setStarter(Starter starter) {
		this.starter = starter;
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

	/** The sources that have a tab, in the order their tabs were opened (the tab strip). */
	public List<ImagerySource> openSources() {
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

	/** The source of the tab shown in the imagery window, or null. */
	public ImagerySource visibleSource() {
		return visible;
	}

	/** Brings the tab of the source to the front, opening it if needed. */
	public void show(ImagerySource source) {
		// Taken as visible at once: its commands, this one first, go ahead of the others
		visible = source;
		call(source, (d, tab) -> {
			d.activate(tab);
			return null;
		});
		visible = source; // again, in case the browser was started anew meanwhile
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
	 * would otherwise queue a slow page load per plot. Runs on the calling thread (the load calls the methods of
	 * {@link ImageryTab}, which go through the worker); a call whose plot was skipped returns at once, and a call may
	 * run the load of a later call instead of its own, so an exception of a load reaches whichever caller ran it.
	 */
	public void loadLatest(ImagerySource source, Runnable load) {
		AtomicReference<Runnable> pending = pendingLoads.get(source);
		pending.set(load);
		synchronized (loadLocks.get(source)) {
			Runnable latest = pending.getAndSet(null);
			if (latest != null) {
				latest.run();
			}
		}
	}

	/** The tab of the source, starting the browser and opening the tab when needed. Called on the worker only. */
	String tabOf(ImagerySource source) throws Exception {
		TabDriver d = driver;
		if (d == null || !d.isAlive()) {
			d = startBrowser();
		}
		boolean useInitial;
		synchronized (tabsLock) {
			String tab = tabOfSource.get(source);
			if (tab != null) {
				return tab;
			}
			useInitial = initialTabFree;
			initialTabFree = false;
		}
		String tab = useInitial ? d.initialTab() : d.createTab();
		synchronized (tabsLock) {
			tabOfSource.put(source, tab);
			sourceOfTab.put(tab, source);
			openingOrder.add(source);
		}
		reporter.breadcrumb(source, "tab opened");
		return tab;
	}

	private TabDriver startBrowser() throws Exception {
		TabDriver d = starter.start();
		synchronized (tabsLock) {
			tabOfSource.clear();
			sourceOfTab.clear();
			openingOrder.clear();
			initialTabFree = true;
		}
		visible = null;
		driver = d;
		d.onTabClosed(tab -> tabClosed(d, tab));
		d.onVisibilityChange((tab, isVisible) -> visibilityChanged(d, tab, isVisible));
		reporter.setBrowser(d.browserName(), d.browserVersion());
		reporter.breadcrumb(null, "browser started");
		return d;
	}

	/** The user closed a tab: its source gets a new one the next time it needs it. */
	private void tabClosed(TabDriver from, String tab) {
		if (from != driver) {
			return; // a late event of a browser that was replaced
		}
		synchronized (tabsLock) {
			if (tab.equals(from.initialTab())) {
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
		synchronized (tabsLock) {
			source = sourceOfTab.get(tab);
		}
		if (source == null) {
			return; // a tab that is not ours
		}
		if (isVisible) {
			visible = source;
		} else if (visible == source) {
			visible = null;
		}
		if (visibilityListeners.isEmpty()) {
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
		ImagerySource source = sourceOfTab.remove(tab);
		if (source != null) {
			tabOfSource.remove(source);
			openingOrder.remove(source);
		}
	}

	/**
	 * Runs the command on the tab of the source, on the worker, and waits for its result. A tab found closed is forgotten,
	 * so the next command of its source opens it again, and the {@link TabClosedException} reaches the caller as it is.
	 * Runtime exceptions reach the caller as they are; a checked one (no browser to start, mostly) wrapped in an
	 * {@link IllegalStateException}, as is a command that took longer than {@link #COMMAND_TIMEOUT_SECONDS}.
	 */
	<T> T call(ImagerySource source, TabCommand<T> command) {
		if (Thread.currentThread() == worker) {
			throw new IllegalStateException("A command of the imagery browser sent from its own worker would wait forever");
		}
		Command<T> queuedCommand = enqueue(source, command);
		try {
			return queuedCommand.result.get(COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS);
		} catch (TimeoutException e) {
			queuedCommand.result.cancel(false); // not run, if it is still waiting
			throw new IllegalStateException("The imagery browser did not answer in " + COMMAND_TIMEOUT_SECONDS
					+ " s, for " + source, e);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			queuedCommand.result.cancel(false);
			throw new IllegalStateException("Interrupted waiting for the imagery browser, for " + source, e);
		} catch (ExecutionException e) {
			throw unchecked(e.getCause());
		}
	}

	private <T> Command<T> enqueue(ImagerySource source, TabCommand<T> command) {
		queueLock.lock();
		try {
			if (stopped) {
				throw new IllegalStateException("The imagery browser was shut down");
			}
			Command<T> queuedCommand = new Command<>(nextSequence++, source, command);
			queues.get(source).add(queuedCommand);
			queued.signal();
			return queuedCommand;
		} finally {
			queueLock.unlock();
		}
	}

	private void work() {
		while (true) {
			Command<?> next;
			try {
				next = take();
			} catch (InterruptedException e) {
				return;
			}
			if (next == null) {
				return;
			}
			execute(next);
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
		String tab = null;
		try {
			tab = tabOf(queuedCommand.source);
			queuedCommand.result.complete(queuedCommand.command.run(driver, tab));
		} catch (TabClosedException e) {
			if (tab != null) {
				synchronized (tabsLock) {
					forget(tab);
				}
			}
			queuedCommand.result.completeExceptionally(e);
		} catch (Throwable e) { // NOSONAR the worker must survive whatever a command throws
			queuedCommand.result.completeExceptionally(e);
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

	/**
	 * Fails the commands still waiting, stops the worker and quits the browser. Waits a little for the command being run,
	 * so that the browser is quit after it rather than under it.
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
			worker.join(SHUTDOWN_WAIT_MILLIS);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
		events.shutdownNow();
		TabDriver d = driver;
		driver = null;
		if (d != null) {
			try {
				d.quit();
			} catch (RuntimeException e) {
				logger.warn("Imagery window: the browser did not quit", e);
			}
		}
	}
}
