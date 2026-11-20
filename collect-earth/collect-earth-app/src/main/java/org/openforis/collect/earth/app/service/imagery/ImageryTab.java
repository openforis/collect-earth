package org.openforis.collect.earth.app.service.imagery;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.util.Arrays;
import java.util.Locale;
import java.util.function.BooleanSupplier;

import org.openqa.selenium.json.Json;
import org.openqa.selenium.json.JsonOutput;

/** The tab of one source. Every method blocks until the browser answered; call them off the event thread. */
public final class ImageryTab {

	/** Marks the document a load leaves: the new document of the page does not have it. */
	private static final String LEAVING_MARK = "window.__collectEarthLeaving";
	/** Marks the document a load leaves ({@link #LEAVING_MARK}) and gives its address, in one round trip. */
	static final String MARK_LEAVING_SCRIPT = "(() => { " + LEAVING_MARK + " = true; return String(location.href); })()";
	private static final Duration POLL = Duration.ofMillis(250);
	/**
	 * How long a poll of {@link #waitUntil} in the tab of a source other than Google Earth Web waits for its answer: a
	 * page still loading may not run it for seconds, and the worker serves no other tab meanwhile, Google Earth Web's
	 * neither. The poll is tried again after it anyway. Google Earth Web keeps the driver's own limit: it is the tab the
	 * user waits for, and its start can keep it busy for longer than this.
	 */
	public static final Duration POLL_SCRIPT_TIMEOUT = Duration.ofSeconds(2);
	/** A wait that nothing cancels. */
	private static final BooleanSupplier NEVER = () -> false;
	private static final Json JSON = new Json();

	private final ImageryBrowser browser;
	private final ImagerySource source;

	ImageryTab(ImageryBrowser browser, ImagerySource source) {
		this.browser = browser;
		this.source = source;
	}

	public ImagerySource source() {
		return source;
	}

	/** Starts loading the URL, without waiting for the page. */
	public void navigate(String url) {
		browser.call(source, (d, tab) -> {
			d.navigate(tab, url);
			browser.navigated(tab);
			return null;
		});
	}

	/**
	 * Loads the URL and waits for the new page to have loaded, or {@code timeout}. {@code reload}: for pages whose URL
	 * only changes in the #fragment, which a navigation alone does not load again. Returns whether it loaded in time.
	 * The wait is a series of short commands, so the other tabs are served meanwhile.
	 * <p>
	 * The reload is sent only when the navigation stays in the document (see {@link #staysInDocument}): a navigation to
	 * another address loads the page by itself, and reloading it on top loaded the page of every plot twice (Firefox 160:
	 * two loads of the new address for one navigation and its reload). The address is the one the browser compares,
	 * the page's own as it is now. When it cannot be read (a page that takes no scripts), the reload is sent as before.
	 * <p>
	 * A navigation that fails (no network, a site that is down) lands on a new, complete error document, so this
	 * returns true then too: whether the page is the one wanted is for the caller to judge. A page that does not take
	 * scripts (an error page, a privileged page) is navigated away from all the same, without the mark.
	 */
	public boolean load(String url, boolean reload, Duration timeout) {
		return load(url, reload, timeout, NEVER);
	}

	/**
	 * As {@link #load(String, boolean, Duration)}, giving up the wait for the page as soon as {@code cancelled} says so
	 * (a newer plot is waiting): false then too, which the caller tells from a timeout by asking it again.
	 */
	public boolean load(String url, boolean reload, Duration timeout, BooleanSupplier cancelled) {
		browser.call(source, (d, tab) -> {
			String leaving = null;
			try {
				leaving = d.evaluate(tab, MARK_LEAVING_SCRIPT);
			} catch (PageScriptException e) {
				// Not marked: the wait may then see the old document as loaded, which is still better than not loading
			}
			d.navigate(tab, url);
			// "null": the page gave no address, which is then not known
			if (reload && (leaving == null || "null".equals(leaving) || staysInDocument(leaving, url))) {
				d.reload(tab);
			}
			browser.navigated(tab);
			return null;
		});
		return waitUntil("return !" + LEAVING_MARK + " && document.readyState === 'complete';", timeout, cancelled);
	}

	/**
	 * Whether a navigation from the page at {@code from} to {@code to} may stay in its document, which a browser only
	 * scrolls to the #fragment instead of loading: {@code to} has a fragment and its address before it is the page's
	 * (HTML's "navigate to a fragment"). An address without a fragment is always loaded, even the same one. Compared as
	 * the browser compares them, not as text: the page's own address is the browser's writing of it (a "/" for an empty
	 * path, the host in lower case, the default port left out, characters escaped), which the configured address of a
	 * source may not be. Only a document that is certainly another counts as one: when in doubt (an address that does
	 * not parse), it may stay, and the caller reloads, as it always did.
	 */
	static boolean staysInDocument(String from, String to) {
		int hash = to.indexOf('#');
		if (hash < 0) {
			return false;
		}
		int fromHash = from.indexOf('#');
		String fromDocument = fromHash < 0 ? from : from.substring(0, fromHash);
		String toDocument = to.substring(0, hash);
		if (fromDocument.equals(toDocument)) {
			return true;
		}
		String a = documentOf(fromDocument);
		String b = documentOf(toDocument);
		return a == null || b == null || a.equals(b);
	}

	/** An address as the browser compares it, or null when it does not parse. */
	private static String documentOf(String address) {
		try {
			URI uri = new URI(address);
			if (!uri.isAbsolute() || uri.isOpaque()) {
				return uri.isOpaque() ? uri.getScheme().toLowerCase(Locale.ROOT) + ":" + uri.getSchemeSpecificPart() : null;
			}
			String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
			String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
			int port = uri.getPort();
			boolean defaultPort = port == -1 || ("https".equals(scheme) && port == 443) || ("http".equals(scheme) && port == 80);
			String path = uri.getPath() == null || uri.getPath().isEmpty() ? "/" : uri.getPath();
			String query = uri.getQuery() == null ? "" : "?" + uri.getQuery();
			return scheme + "://" + host + (defaultPort ? "" : ":" + port) + path + query;
		} catch (URISyntaxException e) {
			return null;
		}
	}

	/**
	 * Runs a function body in the page, like WebDriver's executeScript: {@code arguments[i]} are the args, and what it
	 * returns comes back as Java values (String, Boolean, Long or Double, List, Map), through JSON.
	 */
	public Object evaluate(String body, Object... args) {
		String json = browser.call(source, (d, tab) -> d.evaluate(tab, expression(body, args)));
		return JSON.toType(json, Object.class);
	}

	/**
	 * Like {@link #evaluate}, giving up on the answer after {@code scriptTimeout} (a page busy, see
	 * {@link PageScriptException#isPageBusy()}): for reads that are repeated anyway, within a wait that has a limit and
	 * may be given up, which a read of the driver's own limit would overshoot.
	 */
	public Object evaluateWithin(Duration scriptTimeout, String body, Object... args) {
		String json = browser.call(source, (d, tab) -> d.evaluate(tab, expression(body, args), scriptTimeout));
		return JSON.toType(json, Object.class);
	}

	/**
	 * Like {@link #evaluate}, but only in a tab that is open already: throws {@link TabClosedException} when the browser
	 * is not running or the source has no tab, instead of starting a browser or opening the tab. For checks that a tab
	 * is still there, which must not bring up a new window to find out.
	 */
	public Object evaluateIfOpen(String body, Object... args) {
		String json = browser.callIfOpen(source, (d, tab) -> d.evaluate(tab, expression(body, args)));
		return JSON.toType(json, Object.class);
	}

	/** The expression that runs {@code body} with {@code args} and gives its result as JSON text. */
	static String expression(String body, Object... args) {
		return "(() => { const r = (function () {" + body + "\n}).apply(null, " + compactJson(Arrays.asList(args))
				+ "); return JSON.stringify(r === undefined ? null : r); })()";
	}

	/** {@link Json#toJson} pretty-prints, which would spread the arguments of every script over many lines. */
	private static String compactJson(Object value) {
		StringBuilder text = new StringBuilder();
		try (JsonOutput out = JSON.newOutput(text)) {
			out.setPrettyPrint(false);
			out.write(value);
		}
		return text.toString();
	}

	/**
	 * Polls {@code body} until it returns true or the timeout passes. A script that fails counts as "not yet": while a
	 * page loads, its document is being replaced and does not run scripts. A closed tab ends the wait with
	 * {@link TabClosedException}.
	 */
	public boolean waitUntil(String body, Duration timeout) {
		return waitUntil(body, timeout, NEVER);
	}

	/**
	 * As {@link #waitUntil(String, Duration)}, stopping as soon as {@code cancelled} says so, with false. Each poll in
	 * the tab of a source other than Google Earth Web gives up after {@link #POLL_SCRIPT_TIMEOUT}.
	 */
	public boolean waitUntil(String body, Duration timeout, BooleanSupplier cancelled) {
		long end = System.nanoTime() + timeout.toNanos();
		while (System.nanoTime() - end < 0) {
			if (cancelled.getAsBoolean()) {
				return false;
			}
			try {
				if (Boolean.TRUE.equals(poll(body))) {
					return true;
				}
			} catch (PageScriptException e) {
				// the document is being replaced: poll again
			}
			try {
				Thread.sleep(POLL.toMillis());
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				return false;
			}
		}
		return false;
	}

	/** Runs a poll of {@link #waitUntil}: see {@link #POLL_SCRIPT_TIMEOUT}. */
	private Object poll(String body) {
		if (source == ImagerySource.GOOGLE_EARTH_WEB) {
			return evaluate(body);
		}
		String json = browser.call(source, (d, tab) -> d.evaluate(tab, expression(body), POLL_SCRIPT_TIMEOUT));
		return JSON.toType(json, Object.class);
	}

	public String currentUrl() {
		return String.valueOf(evaluate("return location.href;"));
	}

	/** Whether the tab is open, without opening it. */
	public boolean isOpen() {
		return browser.isOpen(source);
	}

	/** Whether it is the tab shown in its window of the imagery browser. */
	public boolean isVisible() {
		return browser.isShown(source);
	}
}
