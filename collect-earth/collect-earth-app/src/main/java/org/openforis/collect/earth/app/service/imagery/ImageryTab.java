package org.openforis.collect.earth.app.service.imagery;

import java.time.Duration;
import java.util.Arrays;

import org.openqa.selenium.json.Json;
import org.openqa.selenium.json.JsonOutput;

/** The tab of one source. Every method blocks until the browser answered; call them off the event thread. */
public final class ImageryTab {

	/** Marks the document a load leaves: the new document of the page does not have it. */
	private static final String LEAVING_MARK = "window.__collectEarthLeaving";
	private static final Duration POLL = Duration.ofMillis(250);
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
			return null;
		});
	}

	/**
	 * Loads the URL and waits for the new page to have loaded, or {@code timeout}. {@code reload}: for pages whose URL
	 * only changes in the #fragment, which a navigation alone does not load again. Returns whether it loaded in time.
	 * The wait is a series of short commands, so the other tabs are served meanwhile.
	 * <p>
	 * A navigation that fails (no network, a site that is down) lands on a new, complete error document, so this
	 * returns true then too: whether the page is the one wanted is for the caller to judge. A page that does not take
	 * scripts (an error page, a privileged page) is navigated away from all the same, without the mark.
	 */
	public boolean load(String url, boolean reload, Duration timeout) {
		browser.call(source, (d, tab) -> {
			try {
				d.evaluate(tab, LEAVING_MARK + " = true");
			} catch (PageScriptException e) {
				// Not marked: the wait may then see the old document as loaded, which is still better than not loading
			}
			d.navigate(tab, url);
			if (reload) {
				d.reload(tab);
			}
			return null;
		});
		return waitUntil("return !" + LEAVING_MARK + " && document.readyState === 'complete';", timeout);
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
		long end = System.nanoTime() + timeout.toNanos();
		while (System.nanoTime() < end) {
			try {
				if (Boolean.TRUE.equals(evaluate(body))) {
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
