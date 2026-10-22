package org.openforis.collect.earth.app.service.imagery;

import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import javax.annotation.PreDestroy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The one browser that shows the imagery of the plots, with a tab per {@link ImagerySource}, instead of a browser per
 * source. Every command to it goes through one worker thread (one BiDi connection takes its commands in order).
 * A tab is opened the first time its source has something to show; a tab the user closed is opened again then, and a
 * closed browser is started again.
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

	/** Long enough for a slow BiDi command, short enough not to leave the caller waiting for a browser that hung. */
	static final long COMMAND_TIMEOUT_SECONDS = 30;

	private final Logger logger = LoggerFactory.getLogger(ImageryBrowser.class);

	private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Imagery browser");
		thread.setDaemon(true);
		return thread;
	});

	/** Guards the tab maps below: the worker changes them, the browser's listeners and other threads read them. */
	private final Object tabsLock = new Object();
	private final Map<ImagerySource, String> tabOfSource = new EnumMap<>(ImagerySource.class);
	private final Map<String, ImagerySource> sourceOfTab = new HashMap<>();
	private final List<ImagerySource> openingOrder = new ArrayList<>();
	/** Whether the blank tab the browser opened with still waits for a source. */
	private boolean initialTabFree;

	private volatile Starter starter;
	private volatile ImageryErrorReporter reporter;
	private volatile TabDriver driver;
	private volatile ImagerySource visible;

	/** For Spring: the starter and the reporter are set in {@code @PostConstruct} (a later task). */
	public ImageryBrowser() {
	}

	ImageryBrowser(Starter starter, ImageryErrorReporter reporter) {
		this.starter = starter;
		this.reporter = reporter;
	}

	void setStarter(Starter starter) {
		this.starter = starter;
	}

	public ImageryTab tab(ImagerySource source) {
		return new ImageryTab(this, source);
	}

	/** Opens the tabs of these sources that are not open yet, in the order of {@link ImagerySource}. */
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

	/** The tab of the source, starting the browser and opening the tab when needed. Called on the worker only. */
	String tabOf(ImagerySource source) throws Exception {
		TabDriver d = driver;
		if (d == null || !d.isAlive()) {
			d = startBrowser();
		}
		synchronized (tabsLock) {
			String tab = tabOfSource.get(source);
			if (tab != null) {
				return tab;
			}
		}
		String tab;
		boolean useInitial;
		synchronized (tabsLock) {
			useInitial = initialTabFree;
			initialTabFree = false;
		}
		tab = useInitial ? d.initialTab() : d.createTab();
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
		d.onTabClosed(tab -> tabClosed(d, tab));
		d.onVisibilityChange((tab, isVisible) -> visibilityChanged(d, tab, isVisible));
		driver = d;
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

	private void visibilityChanged(TabDriver from, String tab, boolean isVisible) {
		if (from != driver) {
			return;
		}
		ImagerySource source;
		synchronized (tabsLock) {
			source = sourceOfTab.get(tab);
		}
		if (source == null) {
			return;
		}
		if (isVisible) {
			visible = source;
		} else if (visible == source) {
			visible = null;
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
	 */
	<T> T call(ImagerySource source, TabCommand<T> command) {
		Future<T> result = worker.submit(() -> run(source, command));
		try {
			return result.get(COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS);
		} catch (TimeoutException e) {
			result.cancel(true);
			throw new IllegalStateException("The imagery browser did not answer in " + COMMAND_TIMEOUT_SECONDS
					+ " s, for " + source, e);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("Interrupted waiting for the imagery browser, for " + source, e);
		} catch (ExecutionException e) {
			throw unchecked(e.getCause());
		}
	}

	private <T> T run(ImagerySource source, TabCommand<T> command) throws Exception {
		String tab = tabOf(source);
		try {
			return command.run(driver, tab);
		} catch (TabClosedException e) {
			synchronized (tabsLock) {
				forget(tab);
			}
			throw e;
		}
	}

	/** Runtime exceptions and errors as they are; a checked one (no browser to start, mostly) wrapped. */
	private static RuntimeException unchecked(Throwable cause) {
		if (cause instanceof RuntimeException) {
			return (RuntimeException) cause;
		}
		if (cause instanceof Error) {
			throw (Error) cause;
		}
		return new IllegalStateException(String.valueOf(cause.getMessage()), cause);
	}

	/** Quits the browser and stops the worker. */
	@PreDestroy
	public void shutdown() {
		worker.shutdownNow();
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
