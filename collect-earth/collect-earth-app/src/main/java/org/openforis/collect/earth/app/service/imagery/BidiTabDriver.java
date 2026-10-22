package org.openforis.collect.earth.app.service.imagery;

import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

import org.openqa.selenium.Capabilities;
import org.openqa.selenium.NoSuchSessionException;
import org.openqa.selenium.NoSuchWindowException;
import org.openqa.selenium.WindowType;
import org.openqa.selenium.bidi.browsingcontext.BrowsingContext;
import org.openqa.selenium.bidi.browsingcontext.BrowsingContextInfo;
import org.openqa.selenium.bidi.browsingcontext.CreateContextParameters;
import org.openqa.selenium.bidi.browsingcontext.ReadinessState;
import org.openqa.selenium.bidi.module.BrowsingContextInspector;
import org.openqa.selenium.bidi.module.Script;
import org.openqa.selenium.bidi.script.ChannelValue;
import org.openqa.selenium.bidi.script.EvaluateResult;
import org.openqa.selenium.bidi.script.EvaluateResultExceptionValue;
import org.openqa.selenium.bidi.script.EvaluateResultSuccess;
import org.openqa.selenium.bidi.script.Message;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.openqa.selenium.remote.http.ClientConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link TabDriver} over WebDriver BiDi, which loads and scripts a tab without selecting it: classic WebDriver can only
 * work in the selected tab, so it would bring every source to the front in turn.
 * <p>
 * The driver must have been started with BiDi enabled ({@code options.enableBiDi()}) and, so that a BiDi command that
 * gets no answer fails before {@code ImageryBrowser} takes the browser as hung, with {@link #clientConfig()}.
 * <p>
 * Errors: a tab or browser that is gone gives {@link TabClosedException}; a script that throws in the page, or that
 * runs while the page is replacing its document, {@link PageScriptException}; any other failure of a BiDi command an
 * {@link IllegalStateException}, a fault for the worker to report.
 */
public class BidiTabDriver implements TabDriver {

	/**
	 * How long a BiDi command waits for its answer. Selenium takes it from the {@link ClientConfig} of the driver
	 * ({@code wsTimeout}, 30 s by default, or the system property {@code webdriver.httpclient.wsTimeout}) when the
	 * driver is built; it cannot be changed afterwards. It must be shorter than
	 * {@link ImageryBrowser#COMMAND_TIMEOUT_SECONDS}, so that a command with no answer fails on the worker, as a fault
	 * of that command, rather than at the same moment as the caller gives up and quits the whole browser as hung.
	 */
	public static final Duration BIDI_TIMEOUT = Duration.ofSeconds(20);

	/** How long {@link #quit()} waits for the browser to end before leaving it to its own thread. */
	private static final long QUIT_WAIT_MILLIS = 10_000;

	private static final String VISIBILITY_CHANNEL = "collectEarthVisibility";
	/**
	 * Runs in every page before its own scripts: tells Collect Earth when the page is shown or hidden (the user picked
	 * another tab), over a BiDi channel, so the pages never call Collect Earth themselves.
	 */
	private static final String VISIBILITY_PRELOAD = "(channel) => {"
			+ " const send = () => channel(document.visibilityState === 'visible');"
			+ " document.addEventListener('visibilitychange', send); send(); }";

	/**
	 * Parts of the messages that say the tab is gone (lower case). A closed tab answers {@code "error":"no such frame"}
	 * in both browsers, with "Browsing Context with id ... not found" (Firefox 158) or "Context ... not found"
	 * (Chrome 156) as message.
	 */
	private static final String[] TAB_GONE = { "no such frame", "no such window", "no such browsing context" };
	/**
	 * ... that say the browser, or the session with it, is gone. Once the browser ended, a BiDi command fails with
	 * {@code IOException: Output closed} (the WebSocket is closed), a classic one with {@link NoSuchSessionException}.
	 */
	private static final String[] SESSION_GONE = { "output closed", "session not found", "invalid session id",
			"no such session", "connection refused", "connection reset" };
	/**
	 * ... that say the page replaced its document while the script ran, so it had nowhere to finish: try again. Seen
	 * in Chrome 156 for a script waiting on a promise when the page navigated: {@code "error":"unknown error",
	 * "message":"Inspected target navigated or closed"}. Firefox 158 queues a script sent during a navigation and runs
	 * it in the new document, but a promise left pending by a navigation never answers there, so such a script ends
	 * with the BiDi timeout instead ({@link #BIDI_TIMEOUT}). The others are the CDP and Firefox wordings of the same.
	 */
	private static final String[] DOCUMENT_REPLACED = { "inspected target navigated or closed",
			"execution context was destroyed", "cannot find context with specified id",
			"actor 'messagehandlerframe' destroyed", "discardedbrowsingcontexterror" };

	private final Logger logger = LoggerFactory.getLogger(BidiTabDriver.class);

	private final RemoteWebDriver driver;
	private final Script script;
	private final String initialTab;
	private final String browserName;
	private final String browserVersion;

	/**
	 * Whether the browser runs, as far as known without asking it: {@link #isAlive()} is called from other threads,
	 * twice a second, and a {@link RemoteWebDriver} is not safe to use from two threads at once, so it is kept from
	 * what the driver sees instead. It turns false on {@link #quit()}, on a command that finds the session gone, and
	 * when the last tab closes. A window closed whole by the user ends the browser without telling about its last
	 * tab (seen in Firefox 158 and Chrome 156), so that is known only at the next command, which finds the session
	 * gone and fails with {@link TabClosedException}; the command after it starts a new browser.
	 */
	private volatile boolean alive = true;
	private final AtomicBoolean quitting = new AtomicBoolean();
	/** The tabs open, from the browser's events: when none is left the browser has ended. */
	private final Set<String> openTabs = ConcurrentHashMap.newKeySet();
	private final List<Consumer<String>> closedListeners = new CopyOnWriteArrayList<>();
	private final List<BiConsumer<String, Boolean>> visibilityListeners = new CopyOnWriteArrayList<>();

	/** The client settings to build the driver with: a BiDi command waits no longer than {@link #BIDI_TIMEOUT}. */
	public static ClientConfig clientConfig() {
		return ClientConfig.defaultConfig().wsTimeout(BIDI_TIMEOUT);
	}

	/** Starts listening to the browser and installs the visibility script; quits the driver if that fails. */
	public BidiTabDriver(RemoteWebDriver driver) {
		this.driver = driver;
		try {
			Capabilities capabilities = driver.getCapabilities();
			browserName = capabilities.getBrowserName();
			browserVersion = capabilities.getBrowserVersion();
			// The BiDi context id of the first tab: Firefox and Chrome use the same id for the window handle
			initialTab = driver.getWindowHandle();
			script = new Script(driver);
			BrowsingContextInspector inspector = new BrowsingContextInspector(driver);
			inspector.onBrowsingContextCreated(this::contextCreated);
			inspector.onBrowsingContextDestroyed(this::contextDestroyed);
			script.onMessage(this::message);
			openTabs.add(initialTab);
			for (BrowsingContextInfo context : new BrowsingContext(driver, initialTab).getTopLevelContexts()) {
				openTabs.add(context.getId());
			}
			script.addPreloadScript(VISIBILITY_PRELOAD, Collections.singletonList(new ChannelValue(VISIBILITY_CHANNEL)));
		} catch (RuntimeException e) {
			quit();
			throw e;
		}
	}

	@Override
	public String initialTab() {
		return initialTab;
	}

	@Override
	public String createTab() {
		// background: a new BrowsingContext(driver, WindowType.TAB) selects the tab it opens
		return guard(null, false,
				() -> new BrowsingContext(driver, new CreateContextParameters(WindowType.TAB).background(true)).getId());
	}

	@Override
	public void navigate(String tab, String url) {
		guard(tab, false, () -> new BrowsingContext(driver, tab).navigate(url, ReadinessState.NONE));
	}

	@Override
	public void reload(String tab) {
		guard(tab, false, () -> new BrowsingContext(driver, tab).reload(ReadinessState.NONE));
	}

	@Override
	public String evaluate(String tab, String expression) {
		EvaluateResult result = guard(tab, true,
				() -> script.evaluateFunctionInBrowsingContext(tab, expression, true, Optional.empty()));
		if (result instanceof EvaluateResultExceptionValue) {
			throw new PageScriptException(((EvaluateResultExceptionValue) result).getExceptionDetails().getText());
		}
		if (!(result instanceof EvaluateResultSuccess)) {
			throw new IllegalStateException("Unexpected result of a script in tab " + tab + ": " + result);
		}
		Object value = ((EvaluateResultSuccess) result).getResult().getValue().orElse(null);
		return value == null ? "null" : String.valueOf(value);
	}

	@Override
	public void activate(String tab) {
		guard(tab, false, () -> {
			new BrowsingContext(driver, tab).activate();
			return null;
		});
	}

	/** From what the driver saw, without asking the browser: see {@link #alive}. */
	@Override
	public boolean isAlive() {
		return alive;
	}

	/**
	 * Quits on a thread of its own, waiting for it at most {@link #QUIT_WAIT_MILLIS}: the browser may be hung, and a
	 * quit that never returns would hold up the thread that gave up on it for good. Once only, from any thread.
	 */
	@Override
	public void quit() {
		alive = false;
		if (!quitting.compareAndSet(false, true)) {
			return;
		}
		Thread quitter = new Thread(() -> {
			try {
				driver.quit();
			} catch (RuntimeException e) {
				logger.debug("Imagery window: quitting the browser failed, it was gone already", e);
			}
		}, "Imagery browser quit");
		quitter.setDaemon(true);
		quitter.start();
		try {
			quitter.join(QUIT_WAIT_MILLIS);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
		if (quitter.isAlive()) {
			logger.warn("Imagery window: the browser did not quit in {} ms, left to end on its own", QUIT_WAIT_MILLIS);
		}
	}

	@Override
	public void onTabClosed(Consumer<String> listener) {
		closedListeners.add(listener);
	}

	@Override
	public void onVisibilityChange(BiConsumer<String, Boolean> listener) {
		visibilityListeners.add(listener);
	}

	@Override
	public RemoteWebDriver window() {
		return driver;
	}

	@Override
	public String browserName() {
		return browserName;
	}

	@Override
	public String browserVersion() {
		return browserVersion;
	}

	/** Only the tabs: an iframe has a parent. */
	private void contextCreated(BrowsingContextInfo context) {
		if (context.getParentBrowsingContext() == null) {
			openTabs.add(context.getId());
		}
	}

	private void contextDestroyed(BrowsingContextInfo context) {
		if (context.getParentBrowsingContext() != null) {
			return; // an iframe
		}
		openTabs.remove(context.getId());
		if (openTabs.isEmpty()) {
			alive = false; // the last tab closed, and the browser with it
		}
		for (Consumer<String> listener : closedListeners) {
			try {
				listener.accept(context.getId());
			} catch (RuntimeException e) {
				logger.warn("Imagery window: a listener of the closed tabs failed", e);
			}
		}
	}

	private void message(Message message) {
		if (!VISIBILITY_CHANNEL.equals(message.getChannel())) {
			return;
		}
		Optional<String> tab = message.getSource().getBrowsingContext();
		if (!tab.isPresent()) {
			return;
		}
		// A boolean comes as a Boolean; its text is taken too, so that a change in how Selenium reads it is not missed
		Object value = message.getData().getValue().orElse(null);
		boolean visible = Boolean.TRUE.equals(value) || "true".equals(String.valueOf(value));
		for (BiConsumer<String, Boolean> listener : visibilityListeners) {
			try {
				listener.accept(tab.get(), visible);
			} catch (RuntimeException e) {
				logger.warn("Imagery window: a listener of the visible tab failed", e);
			}
		}
	}

	/**
	 * Runs a BiDi command and sorts out its failure: a tab or browser that is gone gives {@link TabClosedException}
	 * (and a browser gone is no longer {@link #alive}); for a script ({@code script}), a document being replaced gives
	 * {@link PageScriptException}, for {@code ImageryTab.waitUntil} to try again; anything else is a fault of the
	 * command, an {@link IllegalStateException}. Selenium wraps the errors often, and BiDi errors come as a plain
	 * {@code WebDriverException} with the JSON of the error as message, so the whole cause chain and the messages are
	 * looked at.
	 */
	private <T> T guard(String tab, boolean script, Callable<T> command) {
		if (!alive) {
			throw new TabClosedException("The imagery browser has ended", null);
		}
		try {
			return command.call();
		} catch (PageScriptException e) {
			throw e;
		} catch (Exception e) {
			String messages = messages(e);
			if (has(e, NoSuchSessionException.class) || contains(messages, SESSION_GONE)) {
				alive = false;
				throw new TabClosedException("The imagery browser has ended", e);
			}
			if (!alive) {
				// The last tab closed while the command ran: whatever it says, the browser is gone
				throw new TabClosedException("The imagery browser has ended", e);
			}
			if (has(e, NoSuchWindowException.class) || contains(messages, TAB_GONE)) {
				throw new TabClosedException("The tab " + tab + " is closed", e);
			}
			if (script && contains(messages, DOCUMENT_REPLACED)) {
				throw new PageScriptException("The page was replacing its document: " + firstLine(e));
			}
			throw new IllegalStateException("A BiDi command failed in tab " + tab + ": " + firstLine(e), e);
		}
	}

	private static boolean has(Throwable failure, Class<? extends Throwable> type) {
		for (Throwable t = failure; t != null; t = t.getCause()) {
			if (type.isInstance(t)) {
				return true;
			}
		}
		return false;
	}

	/** The messages of the whole cause chain, in lower case. */
	private static String messages(Throwable failure) {
		StringBuilder all = new StringBuilder();
		for (Throwable t = failure; t != null; t = t.getCause()) {
			all.append(t.getClass().getSimpleName()).append(": ").append(t.getMessage()).append('\n');
		}
		return all.toString().toLowerCase(Locale.ROOT);
	}

	private static boolean contains(String messages, String[] parts) {
		for (String part : parts) {
			if (messages.contains(part)) {
				return true;
			}
		}
		return false;
	}

	/** Selenium appends build and driver details to its messages; the first line is the error. */
	private static String firstLine(Throwable failure) {
		String message = String.valueOf(failure.getMessage());
		int end = message.indexOf('\n');
		return end < 0 ? message : message.substring(0, end);
	}
}
