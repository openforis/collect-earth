# Tabbed Imagery Window Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the one-browser-per-imagery-source windows with one imagery browser that has a tab per source,
driven in the background with WebDriver BiDi, so Collect Earth shows two windows (plots map + imagery) instead of up
to nine.

**Architecture:** A new `ImageryBrowser` Spring component owns the only imagery browser (started with BiDi) and a
single worker thread through which every command passes. Each source (`ImagerySource`) gets a tab, created on its
first plot; callers use an `ImageryTab` handle (`load`, `evaluate`, `currentUrl`, `isOpen`, `isVisible`) instead of a
`RemoteWebDriver`. The browser is reached through a small `TabDriver` interface, implemented by `BidiTabDriver` with
Selenium and by `FakeTabDriver` in the tests. Faults are reported to Sentry by `ImageryErrorReporter`, once per kind.

**Design:** `docs/plans/2026-10-22-tabbed-imagery-window-design.md` (read it first).

**Tech Stack:** Java 11, Spring 5.3 (field injection, component scan of `org.openforis.collect.earth.app`), Selenium
4.48 BiDi (`org.openqa.selenium.bidi.*`), Sentry Java 8.54, JUnit 5; React 19 + MUI 9 + vitest for the plots map.

---

## Conventions for whoever runs this plan

- **Worktree:** `C:\Users\Alfonso Sanchez-Paus\workspace\collect-earth-tabbed-imagery`, branch `feature/tabbed-imagery`
  (from `feature/gew-viewer`). The Maven project is its `collect-earth` subfolder; every path below is relative to it.
- **Line endings:** the Java, properties and TypeScript files are CRLF in the working tree (`core.autocrlf=true`). The
  Edit/Write tools keep them; scripts that rewrite files must too.
- **Build with JDK 23** (frontend-maven-plugin needs 17+), the code is compiled for Java 11:
  ```powershell
  $env:JAVA_HOME='C:\opt\jdk-23.0.2'
  mvn -q test -pl collect-earth-app '-Dskip.npm' '-Dtest=ImageryBrowserTest' '-Dsurefire.failIfNoSpecifiedTests=false'
  ```
  PowerShell needs the `-D` arguments quoted. `-Dskip.npm` skips the frontend build for Java-only steps.
- **Frontend tests:** from `collect-earth-app/src/main/frontend`: `npx vitest run`.
- **Baseline** (before Task 1): 66 Java tests in `collect-earth-app`, 34 vitest tests, all passing.
- **Messages:** `collect-earth-app/src/main/resources/org/openforis/collect/earth/app/view/Messages*.properties` are
  ISO-8859-1 with `\u` escapes for non-ASCII; en, es, fr, pt carry the plots-map strings.
- **Style:** match the surrounding code: tabs, Javadoc that says *why*, warnings (not errors) for conditions that are not
  faults of Collect Earth. Commit after every task with the attribution line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

New package for the core classes: `org.openforis.collect.earth.app.service.imagery`
(`collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/imagery/`), tests in the same package under
`collect-earth-app/src/test/java/...`.

---

### Task 1: `ImagerySource` and the exceptions

**Files:**
- Create: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/imagery/ImagerySource.java`
- Create: `.../service/imagery/TabClosedException.java`
- Create: `.../service/imagery/PageScriptException.java`

**Step 1: Write them**

```java
package org.openforis.collect.earth.app.service.imagery;

/** The imagery shown for a plot, one tab each in the imagery window, in the order the tabs are opened. */
public enum ImagerySource {
	GOOGLE_EARTH_WEB, ESRI_WAYBACK, PLANET, GEE_APP, EARTH_MAP, STREET_VIEW, EXTRA_MAP, SECURE_WATCH
}
```

```java
package org.openforis.collect.earth.app.service.imagery;

/** The tab, or the whole browser, was closed (by the user, mostly): not a fault, the tab is opened again when needed. */
public class TabClosedException extends RuntimeException {
	private static final long serialVersionUID = 1L;

	public TabClosedException(String message, Throwable cause) {
		super(message, cause);
	}
}
```

```java
package org.openforis.collect.earth.app.service.imagery;

/** A script that Collect Earth runs in a page threw there: a fault of that script (reported to Sentry). */
public class PageScriptException extends RuntimeException {
	private static final long serialVersionUID = 1L;

	public PageScriptException(String message) {
		super(message);
	}
}
```

**Step 2: Compile**

Run: `mvn -q compile -pl collect-earth-app '-Dskip.npm'` → no output, exit 0.

**Step 3: Commit**

```bash
git add collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/imagery
git commit -m "Imagery window: the sources and the exceptions of a tab"
```

---

### Task 2: `ImageryErrorReporter` (Sentry, once per kind)

**Files:**
- Create: `.../service/imagery/ImageryErrorReporter.java`
- Test: `collect-earth-app/src/test/java/org/openforis/collect/earth/app/service/imagery/ImageryErrorReporterTest.java`

**Step 1: Write the failing test**

```java
package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

public class ImageryErrorReporterTest {

	/** Records what would be sent to Sentry. */
	static class RecordingReporter extends ImageryErrorReporter {
		final List<Map<String, String>> sent = new ArrayList<>();

		@Override
		void send(Map<String, String> tags, Throwable error) {
			sent.add(tags);
		}
	}

	@Test
	public void eachKindOfErrorOfASourceIsReportedOncePerSession() {
		RecordingReporter reporter = new RecordingReporter();
		assertTrue(reporter.report(ImagerySource.ESRI_WAYBACK, "page_script", new PageScriptException("x")));
		assertFalse(reporter.report(ImagerySource.ESRI_WAYBACK, "page_script", new PageScriptException("y")));
		// Another kind, another source: reported
		assertTrue(reporter.report(ImagerySource.ESRI_WAYBACK, "bidi_command", new IllegalStateException()));
		assertTrue(reporter.report(ImagerySource.GOOGLE_EARTH_WEB, "page_script", new PageScriptException("z")));
		assertEquals(3, reporter.sent.size());
	}

	@Test
	public void theReportSaysWhichSourceAndBrowser() {
		RecordingReporter reporter = new RecordingReporter();
		reporter.setBrowser("firefox", "158.0");
		reporter.setViewerType("google_earth_web");
		reporter.report(ImagerySource.PLANET, "page_script", new PageScriptException("x"));
		Map<String, String> tags = reporter.sent.get(0);
		assertEquals("PLANET", tags.get("imagery.source"));
		assertEquals("firefox", tags.get("browser"));
		assertEquals("158.0", tags.get("browser.version"));
		assertEquals("true", tags.get("bidi"));
		assertEquals("google_earth_web", tags.get("viewer_type"));
	}
}
```

**Step 2: Run it, it fails**

Run: `mvn -q test -pl collect-earth-app '-Dskip.npm' '-Dtest=ImageryErrorReporterTest' '-Dsurefire.failIfNoSpecifiedTests=false'`
Expected: compilation failure, `cannot find symbol: class ImageryErrorReporter`.

**Step 3: Implement**

```java
package org.openforis.collect.earth.app.service.imagery;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import io.sentry.Breadcrumb;
import io.sentry.Sentry;
import io.sentry.SentryLevel;

/**
 * Sends the faults of the imagery window to Sentry, as the rest of Collect Earth does through the log, but not through
 * the log: an ERROR there also opens the error dialog, and these happen on a plot change, possibly on every one.
 * <ul>
 * <li>Only faults of Collect Earth come here (a BiDi command that fails, a script of ours that throws in a page). A site
 * that is slow or down, a window the user closed, stay warnings in the log.</li>
 * <li>Each kind of error of each source is sent once per session: an error on every plot would otherwise use up the
 * quota of the error reports, as the unreadable balloon value did for nine days in 2026.</li>
 * <li>Breadcrumbs say what the imagery window did before the error.</li>
 * </ul>
 */
@Component
public class ImageryErrorReporter {

	private static final String BREADCRUMB_CATEGORY = "imagery";

	private final Logger logger = LoggerFactory.getLogger(ImageryErrorReporter.class);
	private final Set<String> reported = ConcurrentHashMap.newKeySet();
	private volatile String browser = "unknown";
	private volatile String browserVersion = "unknown";
	private volatile String viewerType = "unknown";

	public void setBrowser(String name, String version) {
		browser = String.valueOf(name);
		browserVersion = String.valueOf(version);
	}

	public void setViewerType(String viewerType) {
		this.viewerType = String.valueOf(viewerType);
	}

	/** Something the imagery window did, for the context of a later report. */
	public void breadcrumb(ImagerySource source, String message) {
		Breadcrumb breadcrumb = new Breadcrumb();
		breadcrumb.setCategory(BREADCRUMB_CATEGORY);
		breadcrumb.setLevel(SentryLevel.INFO);
		breadcrumb.setMessage(message);
		if (source != null) {
			breadcrumb.setData("source", source.name());
		}
		Sentry.addBreadcrumb(breadcrumb);
	}

	/**
	 * Logs the error as a warning and sends it to Sentry the first time this kind of error happens for this source.
	 *
	 * @param kind a short code of what failed: {@code page_script}, {@code bidi_command}, {@code no_bidi_browser}...
	 * @return whether it was sent
	 */
	public boolean report(ImagerySource source, String kind, Throwable error) {
		logger.warn("Imagery window, {}: {}", source, kind, error);
		if (!reported.add(source + "/" + kind)) {
			return false;
		}
		Map<String, String> tags = new LinkedHashMap<>();
		tags.put("imagery.source", String.valueOf(source));
		tags.put("imagery.error", kind);
		tags.put("browser", browser);
		tags.put("browser.version", browserVersion);
		tags.put("bidi", "true");
		tags.put("viewer_type", viewerType);
		send(tags, error);
		return true;
	}

	/** Overridden by the tests. */
	void send(Map<String, String> tags, Throwable error) {
		Sentry.withScope(scope -> {
			tags.forEach(scope::setTag);
			Sentry.captureException(error);
		});
	}
}
```

**Step 4: Run it, it passes**

Same command as Step 2. Expected: `Tests run: 2, Failures: 0`. If `Sentry.withScope` does not compile with 8.54, use
`Sentry.configureScope(...)` is wrong (it is global); look up the 8.x signature with
`javap -cp <sentry-8.54.0.jar> io.sentry.Sentry | findstr withScope` and use the `ScopeCallback` overload.

**Step 5: Commit**

```bash
git add collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/imagery/ImageryErrorReporter.java collect-earth-app/src/test/java/org/openforis/collect/earth/app/service/imagery/ImageryErrorReporterTest.java
git commit -m "Imagery window: report its faults to Sentry, once per kind"
```

---

### Task 3: The `TabDriver` interface and its fake

**Files:**
- Create: `.../service/imagery/TabDriver.java`
- Create (test): `collect-earth-app/src/test/java/org/openforis/collect/earth/app/service/imagery/FakeTabDriver.java`

**Step 1: Write the interface**

```java
package org.openforis.collect.earth.app.service.imagery;

import java.util.function.BiConsumer;
import java.util.function.Consumer;

import org.openqa.selenium.remote.RemoteWebDriver;

/**
 * One browser and its tabs, as {@link ImageryBrowser} needs them. A tab is a BiDi browsing context id. Every call is
 * made from the one worker thread of {@link ImageryBrowser}. Calls on a tab that is gone throw
 * {@link TabClosedException}.
 */
public interface TabDriver {

	/** The tab the browser opened with (blank), used for the first source instead of leaving it empty. */
	String initialTab();

	/** Opens a tab without selecting it, at the end of the tab strip. */
	String createTab();

	/** Starts loading the page and returns without waiting for it. */
	void navigate(String tab, String url);

	/** Starts reloading the page and returns without waiting for it. */
	void reload(String tab);

	/**
	 * Evaluates a JavaScript expression in the page and returns its value as JSON text.
	 *
	 * @throws PageScriptException when the expression throws in the page
	 */
	String evaluate(String tab, String expression);

	/** Selects the tab (brings it to the front of its window). */
	void activate(String tab);

	boolean isAlive();

	void quit();

	/** Called with the tab id when a tab is closed (by the user, mostly). */
	void onTabClosed(Consumer<String> listener);

	/** Called with the tab id and whether its page is now visible (the selected tab of the window). */
	void onVisibilityChange(BiConsumer<String, Boolean> listener);

	/** The classic WebDriver of the window, to move and size it; may be null (tests). */
	RemoteWebDriver window();

	String browserName();

	String browserVersion();
}
```

**Step 2: Write the fake** (records every call in order; the tests drive tab closes and visibility by hand)

```java
package org.openforis.collect.earth.app.service.imagery;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

import org.openqa.selenium.remote.RemoteWebDriver;

/** A browser in memory: which calls were made, in which order, and pages that answer what the test says. */
class FakeTabDriver implements TabDriver {

	final List<String> calls = Collections.synchronizedList(new ArrayList<>());
	final Map<String, String> answers = new HashMap<>();
	final List<String> tabs = Collections.synchronizedList(new ArrayList<>());
	private final List<Consumer<String>> closedListeners = new ArrayList<>();
	private final List<BiConsumer<String, Boolean>> visibilityListeners = new ArrayList<>();
	volatile boolean alive = true;
	/** When set, the first navigate waits for it: the test queues more work behind it. */
	volatile CountDownLatch holdFirstNavigate;
	private int created;

	FakeTabDriver() {
		tabs.add("tab0");
	}

	@Override public String initialTab() { return "tab0"; }

	@Override public synchronized String createTab() {
		String tab = "tab" + (++created);
		tabs.add(tab);
		calls.add("create " + tab);
		return tab;
	}

	@Override public void navigate(String tab, String url) {
		check(tab);
		CountDownLatch hold = holdFirstNavigate;
		if (hold != null) {
			holdFirstNavigate = null;
			try { hold.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
		}
		calls.add("navigate " + tab + " " + url);
	}

	@Override public void reload(String tab) { check(tab); calls.add("reload " + tab); }

	@Override public String evaluate(String tab, String expression) {
		check(tab);
		calls.add("evaluate " + tab);
		for (Map.Entry<String, String> answer : answers.entrySet()) {
			if (expression.contains(answer.getKey())) {
				return answer.getValue();
			}
		}
		return "null";
	}

	@Override public void activate(String tab) { check(tab); calls.add("activate " + tab); }
	@Override public boolean isAlive() { return alive; }
	@Override public void quit() { alive = false; calls.add("quit"); }
	@Override public void onTabClosed(Consumer<String> listener) { closedListeners.add(listener); }
	@Override public void onVisibilityChange(BiConsumer<String, Boolean> listener) { visibilityListeners.add(listener); }
	@Override public RemoteWebDriver window() { return null; }
	@Override public String browserName() { return "fake"; }
	@Override public String browserVersion() { return "1"; }

	/** The user closes the tab. */
	void close(String tab) {
		tabs.remove(tab);
		closedListeners.forEach(l -> l.accept(tab));
	}

	/** The user selects the tab. */
	void select(String tab) {
		for (String other : new ArrayList<>(tabs)) {
			visibilityListeners.forEach(l -> l.accept(other, other.equals(tab)));
		}
	}

	private void check(String tab) {
		if (!alive || !tabs.contains(tab)) {
			throw new TabClosedException(tab + " is closed", null);
		}
	}
}
```

**Step 3: Compile the tests**

Run: `mvn -q test-compile -pl collect-earth-app '-Dskip.npm'` → exit 0.

**Step 4: Commit**

```bash
git add collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/imagery/TabDriver.java collect-earth-app/src/test/java/org/openforis/collect/earth/app/service/imagery/FakeTabDriver.java
git commit -m "Imagery window: the browser as the imagery window needs it, and a fake for the tests"
```

---

### Task 4: `ImageryBrowser` — tabs, one per source, created when first needed

**Files:**
- Create: `.../service/imagery/ImageryBrowser.java`
- Create: `.../service/imagery/ImageryTab.java`
- Test: `.../service/imagery/ImageryBrowserTest.java`

**Step 1: Write the failing tests**

```java
package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.EnumSet;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

public class ImageryBrowserTest {

	private final FakeTabDriver browser = new FakeTabDriver();
	private int starts;
	private final ImageryBrowser imagery = new ImageryBrowser(() -> { starts++; return browser; },
			new ImageryErrorReporterTest.RecordingReporter());

	@AfterEach
	public void stop() {
		imagery.shutdown();
	}

	@Test
	public void theFirstSourceTakesTheTabTheBrowserOpenedWith() {
		imagery.tab(ImagerySource.ESRI_WAYBACK).navigate("https://wayback/1");
		assertEquals(Arrays.asList("navigate tab0 https://wayback/1"), browser.calls);
		assertEquals(1, starts);
	}

	@Test
	public void tabsAreOpenedInTheOrderOfTheSources() {
		imagery.openTabs(EnumSet.of(ImagerySource.EXTRA_MAP, ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.PLANET));
		assertEquals(Arrays.asList(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.PLANET, ImagerySource.EXTRA_MAP),
				imagery.openSources());
		assertEquals(Arrays.asList("create tab1", "create tab2"), browser.calls);
	}

	@Test
	public void aTabTheUserClosedIsOpenedAgainWhenItsSourceNeedsIt() {
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		browser.close("tab0");
		assertFalse(imagery.tab(ImagerySource.PLANET).isOpen());
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/2");
		assertTrue(browser.calls.contains("navigate tab1 https://planet/2"), browser.calls.toString());
	}

	@Test
	public void aClosedBrowserIsStartedAgain() {
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		browser.alive = false;
		FakeTabDriver second = new FakeTabDriver();
		imagery.setStarter(() -> second);
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/2");
		assertEquals(Arrays.asList("navigate tab0 https://planet/2"), second.calls);
	}
}
```

**Step 2: Run, it fails** (`cannot find symbol ImageryBrowser`).

**Step 3: Implement** `ImageryBrowser` (the worker comes in Task 5; here commands run through a single-thread
executor so the tests already exercise the threading) and `ImageryTab`.

```java
package org.openforis.collect.earth.app.service.imagery;

import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
// (Task 5 replaces the executor with the prioritised worker)

/**
 * The one browser that shows the imagery of the plots, with a tab per {@link ImagerySource}, instead of a browser per
 * source. Every command to it goes through one worker thread (one BiDi connection takes its commands in order).
 * A tab is opened the first time its source has something to show; a tab the user closed is opened again then, and a
 * closed browser is started again.
 */
@org.springframework.stereotype.Component
public class ImageryBrowser {

	/** Starts the browser: {@code BrowserService.startImageryBrowser()} in the application, a fake in the tests. */
	@FunctionalInterface
	public interface Starter {
		TabDriver start() throws Exception;
	}

	// fields: starter, reporter, driver (volatile TabDriver), Map<ImagerySource, String> tabs (EnumMap, guarded by
	// this), Map<String, ImagerySource> sourceOfTab, volatile ImagerySource visible, worker
	...
	/** For Spring: the starter and the reporter are set in {@code @PostConstruct} from the autowired services. */
	public ImageryBrowser() { }

	ImageryBrowser(Starter starter, ImageryErrorReporter reporter) { ... }

	void setStarter(Starter starter) { ... }

	public ImageryTab tab(ImagerySource source) { return new ImageryTab(this, source); }

	/** Opens the tabs of these sources that are not open yet, in the order of {@link ImagerySource}. */
	public void openTabs(Collection<ImagerySource> sources) { ... runs on the worker: for each source in enum order, tabOf(source) }

	/** The sources that have a tab, in the order of the tab strip. */
	public List<ImagerySource> openSources() { ... }

	/** Runs on the worker; opens the browser and the tab if needed. */
	String tabOf(ImagerySource source) throws Exception {
		TabDriver d = driver;
		if (d == null || !d.isAlive()) {
			d = startBrowser(); // starter.start(), listeners, reporter.setBrowser, initialTabFree = true, tabs.clear()
		}
		String tab = tabs.get(source);
		if (tab == null) {
			tab = initialTabFree ? d.initialTab() : d.createTab();
			initialTabFree = false;
			tabs.put(source, tab); sourceOfTab.put(tab, source);
			reporter.breadcrumb(source, "tab opened");
		}
		return tab;
	}

	/** Runs the command on the worker for that source and waits for it (see {@link #COMMAND_TIMEOUT}). */
	<T> T call(ImagerySource source, TabCommand<T> command) { ... }

	@FunctionalInterface
	interface TabCommand<T> {
		T run(TabDriver driver, String tab) throws Exception;
	}

	public void shutdown() { ... quit the browser, stop the worker }
}
```

Rules the implementation must follow (they are what the tests check):
- `call()` runs `tabOf(source)` then the command, on the worker, and waits for the result. A `TabClosedException` from
  the command removes that tab from `tabs`/`sourceOfTab` (the next call opens it again) and is rethrown.
- `onTabClosed` from the driver removes the tab the same way (the fake's `close()` calls it).
- `startBrowser()` clears `tabs`/`sourceOfTab`, registers the two listeners, calls
  `reporter.setBrowser(d.browserName(), d.browserVersion())`, and leaves a breadcrumb `"browser started"`.
- `openSources()` returns the sources sorted by their tab's position in the order they were opened (keep a
  `List<ImagerySource>` in opening order, remove on close).

`ImageryTab` (public; GoogleEarthWebService and BrowserService use it):

```java
package org.openforis.collect.earth.app.service.imagery;

import java.time.Duration;
import java.util.Arrays;

import org.openqa.selenium.json.Json;

/** The tab of one source. Every method blocks until the browser answered; call them off the event thread. */
public final class ImageryTab {

	/** Marks the document a load leaves: the new document of the page does not have it. */
	private static final String LEAVING_MARK = "window.__collectEarthLeaving";
	private static final Duration POLL = Duration.ofMillis(250);
	private static final Json JSON = new Json();

	private final ImageryBrowser browser;
	private final ImagerySource source;

	ImageryTab(ImageryBrowser browser, ImagerySource source) { this.browser = browser; this.source = source; }

	public ImagerySource source() { return source; }

	/** Starts loading the URL, without waiting for the page. */
	public void navigate(String url) {
		browser.call(source, (d, tab) -> { d.navigate(tab, url); return null; });
	}

	/**
	 * Loads the URL and waits for the new page to have loaded, or {@code timeout}. {@code reload}: for pages whose URL
	 * only changes in the #fragment, which a navigation alone does not load again. Returns whether it loaded in time.
	 * The wait is a series of short commands, so the other tabs are served meanwhile.
	 */
	public boolean load(String url, boolean reload, Duration timeout) {
		browser.call(source, (d, tab) -> {
			d.evaluate(tab, LEAVING_MARK + " = true");
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

	/** The expression that runs {@code body} with {@code args} and gives its result as JSON text. */
	static String expression(String body, Object... args) {
		return "(() => { const r = (function () {" + body + "\n}).apply(null, " + JSON.toJson(Arrays.asList(args))
				+ "); return JSON.stringify(r === undefined ? null : r); })()";
	}

	/** Polls {@code body} until it returns true or the timeout passes. */
	public boolean waitUntil(String body, Duration timeout) {
		long end = System.nanoTime() + timeout.toNanos();
		while (System.nanoTime() < end) {
			if (Boolean.TRUE.equals(evaluate(body))) {
				return true;
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
	public boolean isOpen() { return browser.isOpen(source); }

	/** Whether it is the tab shown in the imagery window. */
	public boolean isVisible() { return browser.visibleSource() == source; }
}
```

Add `isOpen(source)` (tab mapped and driver alive) and `visibleSource()` to `ImageryBrowser`.

Add a test of `expression` to `ImageryBrowserTest`:

```java
	@Test
	public void aScriptGetsItsArgumentsAndReturnsJson() {
		assertEquals("(() => { const r = (function () {return arguments[0] + 1;\n}).apply(null, [41]); "
				+ "return JSON.stringify(r === undefined ? null : r); })()",
				ImageryTab.expression("return arguments[0] + 1;", 41));
		browser.answers.put("location.href", "\"https://earth.google.com/web/\"");
		assertEquals("https://earth.google.com/web/", imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).currentUrl());
	}
```

**Step 4: Run, they pass** (`-Dtest=ImageryBrowserTest`): 5 tests, 0 failures.

**Step 5: Commit**

```bash
git add collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/imagery collect-earth-app/src/test/java/org/openforis/collect/earth/app/service/imagery
git commit -m "Imagery window: one browser, a tab per source, opened when first needed"
```

---

### Task 5: The worker — the visible tab first, the latest plot only

**Files:**
- Modify: `.../service/imagery/ImageryBrowser.java`
- Test: `.../service/imagery/ImageryBrowserTest.java`

**Step 1: Write the failing tests**

```java
	@Test
	public void theVisibleTabIsServedFirst() throws Exception {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK, ImagerySource.PLANET));
		browser.select("tab1"); // Wayback shown
		browser.calls.clear();
		java.util.concurrent.CountDownLatch hold = new java.util.concurrent.CountDownLatch(1);
		browser.holdFirstNavigate = hold;
		Thread first = new Thread(() -> imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("gew/0"));
		first.start();
		Thread.sleep(200); // the worker is now inside that navigate
		Thread planet = new Thread(() -> imagery.tab(ImagerySource.PLANET).navigate("planet/1"));
		planet.start();
		Thread.sleep(100);
		Thread wayback = new Thread(() -> imagery.tab(ImagerySource.ESRI_WAYBACK).navigate("wayback/1"));
		wayback.start();
		Thread.sleep(100);
		hold.countDown();
		first.join(); planet.join(); wayback.join();
		assertEquals(Arrays.asList("navigate tab0 gew/0", "navigate tab1 wayback/1", "navigate tab2 planet/1"),
				browser.calls);
	}

	@Test
	public void onlyTheLatestPlotOfASourceIsLoaded() throws Exception {
		java.util.List<String> loaded = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
		java.util.concurrent.CountDownLatch inFirst = new java.util.concurrent.CountDownLatch(1);
		java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
		Thread a = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> {
			loaded.add("1"); inFirst.countDown(); await(release); }));
		a.start();
		inFirst.await();
		Thread b = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> loaded.add("2")));
		Thread c = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> loaded.add("3")));
		b.start(); Thread.sleep(50); c.start(); Thread.sleep(50);
		release.countDown();
		a.join(); b.join(); c.join();
		assertEquals(Arrays.asList("1", "3"), loaded);
	}

	private static void await(java.util.concurrent.CountDownLatch latch) {
		try { latch.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
	}

	@Test
	public void theVisibleSourceFollowsTheBrowser() {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK));
		browser.select("tab1");
		assertEquals(ImagerySource.ESRI_WAYBACK, imagery.visibleSource());
		imagery.show(ImagerySource.GOOGLE_EARTH_WEB);
		assertTrue(browser.calls.contains("activate tab0"));
	}
```

**Step 2: Run, they fail** (`loadLatest`, `show` missing; order wrong).

**Step 3: Implement**
- Replace the executor with a worker thread (daemon, named `"Imagery browser"`) that takes from per-source FIFO queues
  (`EnumMap<ImagerySource, ArrayDeque<Command>>`, guarded by a lock + condition): when the visible source has a
  command it goes first; otherwise the command with the lowest sequence number across the queues. `call()` enqueues and
  waits on a `CompletableFuture` with `COMMAND_TIMEOUT = 30 s`; a timeout throws `IllegalStateException`.
- Commands without a source (`openTabs`, `show`) use the queue of the source they act on.
- `loadLatest(source, Runnable load)`: per-source `AtomicReference<Runnable> pending` + per-source lock, like
  `GoogleEarthWebService.showPlot`: set pending, then under the lock take and run it. The runnable runs on the caller's
  thread (it calls `ImageryTab` methods, which go through the worker).
- The visibility listener sets `visible` to the source of a tab reported visible (and to null when the visible one
  reports hidden); it also calls the listeners added with `onVisibilityChange(BiConsumer<ImagerySource, Boolean>)`
  (GoogleEarthWebService uses it in Task 9). Keep the listener calls off the BiDi event thread: hand them to a small
  single-thread executor.
- `show(source)`: on the worker, `d.activate(tabOf(source))`, and set `visible = source` at once (the event confirms it).

**Step 4: Run, all ImageryBrowserTest tests pass** (8).

**Step 5: Commit** — `"Imagery window: the visible tab first, only the latest plot of each source"`.

---

### Task 6: `BidiTabDriver` — the real browser

**Files:**
- Create: `.../service/imagery/BidiTabDriver.java`
- Test: `.../service/imagery/BidiTabDriverIT.java` (runs only with `-Dce.browserTests=true`)

**Step 1: Write the browser test** (the experiment `BackgroundTabs.java` of the design, as a test)

```java
package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.EnumSet;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;

/** Needs Firefox. mvn test -Dtest=BidiTabDriverIT -Dce.browserTests=true */
@EnabledIfSystemProperty(named = "ce.browserTests", matches = "true")
public class BidiTabDriverIT {

	@Test
	public void aBackgroundTabLoadsAndRunsScriptsWithoutBeingShown() {
		FirefoxOptions options = new FirefoxOptions();
		options.enableBiDi();
		ImageryBrowser imagery = new ImageryBrowser(() -> new BidiTabDriver(new FirefoxDriver(options)),
				new ImageryErrorReporterTest.RecordingReporter());
		try {
			imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK));
			imagery.show(ImagerySource.GOOGLE_EARTH_WEB);
			ImageryTab shown = imagery.tab(ImagerySource.GOOGLE_EARTH_WEB);
			ImageryTab hidden = imagery.tab(ImagerySource.ESRI_WAYBACK);
			assertTrue(shown.load("data:text/html,<title>shown</title>", false, Duration.ofSeconds(10)));
			for (int i = 1; i <= 3; i++) {
				assertTrue(hidden.load("data:text/html,<title>plot" + i + "</title>", false, Duration.ofSeconds(10)));
				assertEquals("visible", shown.evaluate("return document.visibilityState;"));
				assertEquals("hidden", hidden.evaluate("return document.visibilityState;"));
			}
			assertEquals(42L, hidden.evaluate("return arguments[0] * 2;", 21));
			// The visibility reports reach Collect Earth
			imagery.show(ImagerySource.ESRI_WAYBACK);
			assertTrue(hidden.waitUntil("return document.visibilityState === 'visible';", Duration.ofSeconds(5)));
			sleep(500);
			assertEquals(ImagerySource.ESRI_WAYBACK, imagery.visibleSource());
		} finally {
			imagery.shutdown();
		}
	}

	private static void sleep(long millis) {
		try { Thread.sleep(millis); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
	}
}
```

**Step 2: Run, it fails** (no `BidiTabDriver`):
`mvn -q test -pl collect-earth-app '-Dskip.npm' '-Dtest=BidiTabDriverIT' '-Dce.browserTests=true' '-Dsurefire.failIfNoSpecifiedTests=false'`

**Step 3: Implement** with the Selenium 4.48 BiDi API (signatures checked with javap):

```java
package org.openforis.collect.earth.app.service.imagery;

// imports: java.util.*, java.util.function.*, org.openqa.selenium.*, org.openqa.selenium.bidi.browsingcontext.*,
// org.openqa.selenium.bidi.module.BrowsingContextInspector, org.openqa.selenium.bidi.module.Script,
// org.openqa.selenium.bidi.script.*, org.openqa.selenium.remote.RemoteWebDriver

/** {@link TabDriver} over WebDriver BiDi: tabs are loaded and scripted without being selected. */
public class BidiTabDriver implements TabDriver {

	private static final String VISIBILITY_CHANNEL = "collectEarthVisibility";
	/**
	 * Runs in every page before its own scripts: tells Collect Earth when the page is shown or hidden (the user picked
	 * another tab), over a BiDi channel, so the pages never call Collect Earth themselves.
	 */
	private static final String VISIBILITY_PRELOAD = "(channel) => {"
			+ " const send = () => channel(document.visibilityState === 'visible');"
			+ " document.addEventListener('visibilitychange', send); send(); }";

	private final RemoteWebDriver driver;
	private final Script script;
	private final BrowsingContextInspector inspector;
	private final String initialTab;

	public BidiTabDriver(RemoteWebDriver driver) {
		this.driver = driver;
		this.initialTab = driver.getWindowHandle(); // the BiDi context id of the first tab
		this.script = new Script(driver);
		this.inspector = new BrowsingContextInspector(driver);
		script.addPreloadScript(VISIBILITY_PRELOAD, Collections.singletonList(new ChannelValue(VISIBILITY_CHANNEL)));
	}

	@Override public String initialTab() { return initialTab; }

	@Override public String createTab() {
		return guard(null, () -> new BrowsingContext(driver,
				new CreateContextParameters(WindowType.TAB).background(true)).getId());
	}

	@Override public void navigate(String tab, String url) {
		guard(tab, () -> new BrowsingContext(driver, tab).navigate(url, ReadinessState.NONE));
	}

	@Override public void reload(String tab) {
		guard(tab, () -> new BrowsingContext(driver, tab).reload(ReadinessState.NONE));
	}

	@Override public String evaluate(String tab, String expression) {
		EvaluateResult result = guard(tab,
				() -> script.evaluateFunctionInBrowsingContext(tab, expression, true, Optional.empty()));
		if (result instanceof EvaluateResultExceptionValue) {
			throw new PageScriptException(((EvaluateResultExceptionValue) result).getExceptionDetails().getText());
		}
		return String.valueOf(((EvaluateResultSuccess) result).getResult().getValue().orElse("null"));
	}

	@Override public void activate(String tab) { guard(tab, () -> { new BrowsingContext(driver, tab).activate(); return null; }); }

	@Override public boolean isAlive() {
		try { driver.getWindowHandles(); return true; } catch (Exception e) { return false; }
	}

	@Override public void quit() { try { driver.quit(); } catch (Exception e) { /* already gone */ } }

	@Override public void onTabClosed(Consumer<String> listener) {
		inspector.onBrowsingContextDestroyed(info -> listener.accept(info.getId()));
	}

	@Override public void onVisibilityChange(BiConsumer<String, Boolean> listener) {
		script.onMessage(message -> {
			if (VISIBILITY_CHANNEL.equals(message.getChannel())) {
				message.getSource().getBrowsingContext().ifPresent(tab ->
						listener.accept(tab, Boolean.TRUE.equals(message.getData().getValue().orElse(false))));
			}
		});
	}

	@Override public RemoteWebDriver window() { return driver; }
	@Override public String browserName() { return driver.getCapabilities().getBrowserName(); }
	@Override public String browserVersion() { return driver.getCapabilities().getBrowserVersion(); }

	/** Runs a BiDi call; a gone tab or browser becomes {@link TabClosedException}. */
	private <T> T guard(String tab, java.util.concurrent.Callable<T> call) { ... }
}
```

`guard` rethrows as `TabClosedException` when the cause chain has `NoSuchWindowException`, `NoSuchSessionException`,
or a message containing `no such frame`, `no such window`, `Browsing context`...`not found`, `Session not found`;
`PageScriptException` passes through; anything else is wrapped in `IllegalStateException` (a BiDi fault: Task 7 reports
it). Copy the cause-chain walk of `BrowserService.windowWasClosed`.

**Step 4: Run the browser test, it passes** (Firefox opens two tabs, closes). If `message.getData().getValue()` is not
a Boolean for a boolean, read `getType()` and compare the value's string form: check it in the debugger once.

**Step 5: Run all ImageryBrowserTest + ImageryErrorReporterTest again**, they still pass.

**Step 6: Commit** — `"Imagery window: drive the tabs over WebDriver BiDi"`.

---

### Task 7: Start the imagery browser, and report its faults

**Files:**
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/BrowserService.java`
- Modify: `.../service/imagery/ImageryBrowser.java`

**Step 1: `BrowserService.startImageryBrowser()`** (public), next to `initAppWindow`:
- Browser order: the one chosen in the options (`EarthProperty.BROWSER_TO_USE`), then Firefox, Edge, Chrome.
- Every option set gets `enableBiDi()`.
- **Firefox:** a persistent profile `FolderFinder.getCollectEarthDataFolder()/browser_profiles/imagery_firefox`,
  passed with `options.addArguments("-profile", dir.getAbsolutePath())` (not `FirefoxProfile`, which copies it to a
  temporary folder and loses the sign-ins). Write `dir/chrome/userChrome.css` with
  `#nav-bar, #PersonalToolbar { visibility: collapse !important; }` (the tab strip stays, it is how sources are
  switched) and `dir/user.js` with `user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);`.
- **Chrome / Edge:** a normal window (not `--app`, which has no tabs) with `--user-data-dir=` the folder
  `browser_profiles/imagery` (rename of the `browser_profiles/google_earth_web` that `GoogleEarthWebService` used:
  rename the folder on first start if the new one does not exist, so the Google sign-in is kept),
  `--no-first-run`, `--no-default-browser-check`.
- When a start fails with the profile (in use by another Collect Earth), try the same browser without it, as now.
- Returns `new BidiTabDriver(driver)`; adds the driver to `drivers` (quit on exit). When none starts, throw
  `BrowserNotFoundException` and call `imageryErrorReporter.report(null, "no_bidi_browser", e)`.

**Step 2: Wire `ImageryBrowser` in Spring**

```java
	@Autowired
	private BrowserService browserService;
	@Autowired
	private ImageryErrorReporter reporter;
	@Autowired
	private LocalPropertiesService localPropertiesService;

	@PostConstruct
	public void init() {
		starter = browserService::startImageryBrowser;
		reporter.setViewerType(localPropertiesService.getViewerType());
	}

	@PreDestroy
	public void shutdown() { ... }
```
(The test constructor sets the fields directly; `@PostConstruct` is not called there.)

**Step 3: Report faults in the worker** — when a command throws:
- `TabClosedException`: warning only, breadcrumb `"tab closed"`.
- `PageScriptException`: `reporter.report(source, "page_script", e)`.
- `IllegalStateException` from `BidiTabDriver.guard` (BiDi fault): `reporter.report(source, "bidi_command", e)`.
Add an `ImageryBrowserTest` case: a fake whose `evaluate` throws `PageScriptException` twice → the recording reporter
has one report with `imagery.error=page_script`. (Make the fake throw for an expression containing `"throw"`.)

**Step 4: Run the Java tests** (`-Dtest=Imagery*`), pass. **Compile the module**, exit 0.

**Step 5: Commit** — `"Imagery window: one browser with tabs, a profile that keeps the sign-ins"`.

---

### Task 8: The sources load in their tabs

**Files:**
- Modify: `.../service/BrowserService.java` (`openPlanetMaps`, `openPlanetTfoMode`, `openPlanetDailyMode`,
  `openSecureWatch`, `openExtraMap`, `openStreetView`, `openGEEAppURL`, `openEarthMapURL`, `openEsriWayback`,
  `loadPlotInDGMap`, `loadPlotInEsriWayback`, `getOtherImageryWindows`)
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/server/PlacemarkBrowserServlet.java`

**Step 1: BrowserService**
- `@Autowired private ImageryBrowser imageryBrowser;`
- Each `openX` keeps building the URL exactly as now; replace `webDriverX = navigateTo(url, webDriverX)` with
  `imageryBrowser.loadLatest(SOURCE, () -> imageryBrowser.tab(SOURCE).load(url, true, PAGE_LOAD_TIMEOUT))`
  (`PAGE_LOAD_TIMEOUT = Duration.ofSeconds(60)`; `reload = true` reproduces the forced refresh of `navigateTo`,
  needed for the `#fragment` URLs of Wayback and the GEE app). Remove the `synchronized (lock)` blocks and the
  `BrowserType` entries of the imagery sources (keep `LEAFLET_MAP`); `loadLatest` coalesces now. Mapping:
  Planet → `PLANET`, SecureWatch → `SECURE_WATCH`, extra → `EXTRA_MAP`, Street View → `STREET_VIEW`,
  GEE app → `GEE_APP`, Earth Map → `EARTH_MAP`, Wayback → `ESRI_WAYBACK`.
- A load that does not finish in time: `logger.warn("{} did not load in time", source)` (a slow site is not a fault).
- `loadPlotInEsriWayback(placemark)` → on the tab:
  `tab.waitUntil("return !!document.querySelector('.esri-view');", Duration.ofSeconds(60))`, then
  `tab.evaluate(getEsriWaybackJavascript(placemark))`. The template is a script body, as for `executeScript`.
- `loadPlotInDGMap(placemark)` → `tab.waitUntil("return !!(document.getElementById('mainContent') || document.getElementsByName('mainContent').length);", 60 s)`,
  `tab.evaluate(getDGMapJavascript(placemark))`, sleep `PLOT_LOAD_SLEEP_MILLIS`, then
  `tab.evaluate("var l = document.querySelector('.lock.on'); if (l) { l.click(); }")` (the click on the lock, without
  classic WebDriver, which would select the tab).
- Delete the seven `webDriverX` imagery fields and `getOtherImageryWindows()`. Then delete whatever is left unused
  (`grep` each: `isCssElementPresent`, `waitForCssElement`, `clickOnElements`, `waitFor`, `waitForXPath`,
  `isXPathPresent`, `CSS_LOCK_ON`, `ESRI_WAYBACK_READY_CSS`...). Keep `navigateTo`/`initBrowser`/`initAppWindow`:
  the plots map window still uses them.
- `public Set<ImagerySource> enabledImagerySources()`: `GOOGLE_EARTH_WEB` when `isGoogleEarthWebViewer()`, then each
  source whose `isXSupported()` / non-blank URL check is true (the same checks the `openX` methods make; Planet also
  needs its key).

**Step 2: PlacemarkBrowserServlet** — in `OpenBrowserThread.run()`, before the `openWindowAsync` calls:
`imageryBrowser.openTabs(browserService.enabledImagerySources());` (inside the try; the tabs then open in the order of
`ImagerySource` whatever order the loads arrive in). Autowire `ImageryBrowser`.

**Step 3: Compile; run all Java tests** (`mvn -q test -pl collect-earth-app '-Dskip.npm'`): 66 + the new ones, 0
failures.

**Step 4: Commit** — `"Imagery window: every source loads in its own tab"`.

---

### Task 9: Google Earth Web in its tab

**Files:**
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/GoogleEarthWebService.java`

**Step 1: Replace the driver with the tab** — `@Autowired private ImageryBrowser imageryBrowser;` and
`private ImageryTab tab() { return imageryBrowser.tab(ImagerySource.GOOGLE_EARTH_WEB); }`. Mechanical mapping:

| Before | After |
|---|---|
| `driver != null && browserService.isDriverWorking(driver)` | `tab().isOpen()` |
| `driver.executeScript(S, a)` | `tab().evaluate(S, a)` (the scripts use `return` and `arguments[i]`, which work inside the function wrapper) |
| `driver.getCurrentUrl()` | `tab().currentUrl()` |
| `browserService.initAppWindow(profileFolder())` + `browserService.navigateTo(url, window, true, false)` | `tab().load(url, false, PAGE_LOAD_TIMEOUT)` (60 s) |
| `driver = null` (window closed) | nothing: the tab reopens on the next plot |

- Delete `driver`, `getDriver()`, `profileFolder()`, `PROFILE_FOLDER` (moved to `BrowserService` in Task 7).
- The layout after a new window (`windowLayoutService.arrange()` when `!windowOpen`) moves to `WindowLayoutService`
  in Task 10; delete it here.
- `BrowserNotFoundException` from the tab (no browser) → `setState(State.ERROR, plotId, MESSAGE_NO_BROWSER)`, as now.
- `injectOverlay` failing with `PageScriptException` is already reported by the worker; keep the warning and the
  `false` result.

**Step 2: While the tab is hidden** (see the design, section 2):
- `checkWindow()`: after the closed check, `if (!tab().isVisible()) return;` (no camera reading for a hidden tab:
  nobody can move it, and Firefox's throttled timers would report stale positions).
- `moveCamera(...)`: when the tab is hidden, keep the target in `private final AtomicReference<double[]>
  cameraWhileHidden` and return.
- In `@PostConstruct`, `imageryBrowser.onVisibilityChange((source, visible) -> { if (source == GOOGLE_EARTH_WEB &&
  visible) shown(); })`, where `shown()` takes the lock and, when `state == READY && current != null`, calls
  `injectOverlay(current)`, then applies `cameraWhileHidden.getAndSet(null)` with `moveCamera`.
- `navigateInPage`: decide `inPageNavigation = FALSE` only if the tab was visible during the whole attempt (check
  `tab().isVisible()` before and after). A hidden Google Earth Web may not fly until it is shown, which must not
  switch off in-page moves for the rest of the session.

**Step 3: Compile, run all Java tests**, 0 failures.

**Step 4: Commit** — `"Google Earth Web: a tab of the imagery window, quiet while hidden"`.

---

### Task 10: Two windows to lay out; Show all goes

**Files:**
- Modify: `.../service/WindowLayoutService.java`
- Modify: `collect-earth-app/src/test/java/org/openforis/collect/earth/app/service/WindowLayoutTest.java`
- Modify: `.../server/PlacemarkBrowserServlet.java` (remove `/googleEarthWeb/arrangeAll`)
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/view/CollectEarthWindow.java`
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/view/ExternalServicesPanel.java`
- Modify: `Messages.properties`, `Messages_es.properties`, `Messages_fr.properties`, `Messages_pt.properties`

**Step 1: WindowLayoutService**
- Replace the three `googleEarthWebService.getDriver()` with `imageryBrowser.window()` (add to `ImageryBrowser`:
  the classic driver of the window, switched to the visible tab first — `switchTo().window(visibleTab)` selects a tab
  in Firefox, so only ever switch to the one already visible; null when no browser). Remove the `@Lazy
  GoogleEarthWebService` field.
- Gate on `localPropertiesService.isPlotsMapViewer()` instead of `isGoogleEarthWebViewer()` (with the plots map alone
  there is an imagery window to place too). The classic viewer keeps the browser where it opens.
- `@PostConstruct`: `imageryBrowser.onBrowserStarted(this::arrange)` (add `onBrowserStarted(Runnable)` to
  `ImageryBrowser`, called on the listener executor after `startBrowser()`): a new imagery window is laid out, as
  `GoogleEarthWebService` did for its window.
- Delete `arrangeAll()`, `imageryRoom(...)`, `tile(...)`; rename the private `raise` to public
  `bringForward(RemoteWebDriver)`; log messages say "imagery window" instead of "Google Earth Web".
- WindowLayoutTest: delete `theOtherImageryWindowsShareTheRoomOfGoogleEarthWeb`. Run it: 10 tests pass.

**Step 2: Servlet** — delete `arrangeAllWindows` (`/googleEarthWeb/arrangeAll`).

**Step 3: Main window** — `CollectEarthWindow.createBrowserWindowsPanel()`: delete the "Show all" button; the panel is
shown when `isPlotsMapViewer()` (was: Google Earth Web only) in `showViewerType()`. `ExternalServicesPanel`: the layout
combo is enabled for the plots map viewers too. Delete the message keys `CollectEarthWindow.showAllWindows` and
`CollectEarthWindow.showAllWindowsTooltip` from the four Messages files.

**Step 4: Compile, run all Java tests**, 0 failures.

**Step 5: Commit** — `"Window layout: the plots map and the imagery window"`.

---

### Task 11: Source buttons in the plots map

**Files:**
- Modify: `.../server/PlacemarkBrowserServlet.java` (two endpoints)
- Create: `collect-earth-app/src/main/frontend/src/imagery.ts`, `imagery.test.ts`
- Create: `collect-earth-app/src/main/frontend/src/components/ImageryBar.tsx`
- Modify: `types.ts`, `api.ts`, `controller.ts`, `i18n.ts`, `components/FormPanel.tsx`, `components/GewChip.tsx`

**Step 1: Endpoints**

```java
	/** The sources open in the imagery window, in tab order, and the one shown: the source buttons of the plots map. */
	@GetMapping(path = "/imagery/status")
	public void imageryStatus(HttpServletResponse response) throws IOException {
		Map<String, Object> status = new LinkedHashMap<>();
		status.put("sources", imageryBrowser.openSources());
		ImagerySource visible = imageryBrowser.visibleSource();
		status.put("visible", visible == null ? null : visible.name());
		response.setHeader("Content-Type", "application/json; charset=UTF-8");
		new ObjectMapper().writeValue(response.getOutputStream(), status);
	}

	/** Brings the tab of a source to the front, and the imagery window over the others. */
	@GetMapping(path = "/imagery/show")
	public void showImagery(HttpServletResponse response, @RequestParam("source") String source) {
		ImagerySource chosen;
		try {
			chosen = ImagerySource.valueOf(source);
		} catch (IllegalArgumentException e) {
			response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
			return;
		}
		executor.submit(() -> {
			imageryBrowser.show(chosen);
			windowLayoutService.bringForward(imageryBrowser.window());
		});
		response.setStatus(HttpServletResponse.SC_OK);
	}
```

**Step 2: The failing vitest** — `src/imagery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { imageryChoices } from "./imagery";

describe("imageryChoices", () => {
  it("offers nothing to switch with one tab or none", () => {
    expect(imageryChoices({ sources: [], visible: null })).toEqual([]);
    expect(imageryChoices({ sources: ["GOOGLE_EARTH_WEB"], visible: "GOOGLE_EARTH_WEB" })).toEqual([]);
  });
  it("lists the tabs in their order and marks the one shown", () => {
    expect(imageryChoices({ sources: ["GOOGLE_EARTH_WEB", "ESRI_WAYBACK"], visible: "ESRI_WAYBACK" })).toEqual([
      { source: "GOOGLE_EARTH_WEB", shown: false },
      { source: "ESRI_WAYBACK", shown: true },
    ]);
  });
});
```

Run `npx vitest run src/imagery.test.ts` → fails (no module).

**Step 3: Implement**
- `types.ts`:
  ```ts
  export type ImagerySource = "GOOGLE_EARTH_WEB" | "ESRI_WAYBACK" | "PLANET" | "GEE_APP" | "EARTH_MAP"
    | "STREET_VIEW" | "EXTRA_MAP" | "SECURE_WATCH";
  /** The tabs of the imagery window (/imagery/status). */
  export interface ImageryStatus { sources: ImagerySource[]; visible: ImagerySource | null }
  ```
- `imagery.ts`:
  ```ts
  import type { ImagerySource, ImageryStatus } from "./types";

  /** The source buttons: one per tab, none when there is nothing to switch between. */
  export function imageryChoices(status: ImageryStatus): { source: ImagerySource; shown: boolean }[] {
    if (status.sources.length < 2) return [];
    return status.sources.map((source) => ({ source, shown: source === status.visible }));
  }
  ```
- `api.ts`: `fetchImageryStatus(): Promise<ImageryStatus>` (`HOST + "imagery/status"`, throws when not ok, as
  `fetchGewStatus`) and `showImagerySource(source)` (`HOST + "imagery/show?source=" + source`, errors ignored). Delete
  `gewShowAllWindows`.
- `controller.ts`: `imagery: ImageryStatus` in `UiState` (initially `{ sources: [], visible: null }`); `pollImagery`
  every `IMAGERY_POLL_MILLIS = 2000`, started in `start()`, updating the state only when the sources or the visible one
  changed; `showImagery = (source) => { showImagerySource(source); this.set({ imagery: { ...this.state.imagery,
  visible: source } }); }`. Delete `showAllWindows`.
- `components/ImageryBar.tsx`: a `ToggleButtonGroup` (`size="small"`, `exclusive`, value = the shown source,
  `onChange` → `controller.showImagery`), one `ToggleButton` per `imageryChoices(state.imagery)` with the label
  `t("imagery.source." + source)`, in a `Box` with `overflowX: "auto"` and `aria-label={t("imagery.label")}`,
  `data-testid="imagery-bar"`; renders `null` when there are no choices.
- `FormPanel.tsx`: `<ImageryBar controller={controller} state={state} />` right under the header `Stack`.
- `GewChip.tsx`: delete the "Show all windows" `MenuItem` and the `FlipToFrontIcon` import.
- `i18n.ts` (en, es, fr, pt; the catalogues are typed, so a missing key fails to compile): delete `gew.showAll`,
  `gew.showAllHint`; add `imagery.label` (en "Imagery shown", es "Imágenes mostradas", fr "Imagerie affichée",
  pt "Imagens mostradas") and `imagery.source.<SOURCE>` for the eight sources: Google Earth Web, ESRI Wayback, Planet,
  Earth Engine, Earth Map, Street View, the extra URL (en "Extra map", es "Mapa adicional", fr "Carte supplémentaire",
  pt "Mapa adicional"), SecureWatch. Product names stay untranslated.

**Step 4: Run** `npx vitest run` → 36 tests pass (34 + 2). `npx tsc --noEmit` (or `npm run build`) → no errors.

**Step 5: Build the app with the frontend** (`mvn -q package -pl collect-earth-app -DskipTests`), exit 0.

**Step 6: Commit** — `"Plots map: buttons to show the tab of each imagery source"`.

---

### Task 12: Changelog, then try it for real

**Files:**
- Modify: `CHANGELOG.md` (Unreleased)

**Step 1: Changelog** — in the "Browser windows" entry, replace the sentence about "Show all" with: the imagery opens
in one browser window with a tab per source (Google Earth Web, ESRI Wayback, Planet, Earth Engine, Earth Map, Street
View, the extra URL), with every viewer; a new plot loads in every tab without changing the one being looked at, and
buttons in the plots map bring a source to the front. One browser instead of one per source also uses much less
memory. Under "Changed" if the classic-viewer change reads better there.

**Step 2: Full test run** — `mvn -q test -pl collect-earth-app` (with the frontend) and `npx vitest run`: all pass.
Then the browser test: `-Dtest=BidiTabDriverIT -Dce.browserTests=true`: passes.

**Step 3: By hand** (use `@superpowers:verification-before-completion`), with `viewer_type=google_earth_web`, ESRI
Wayback and an extra URL switched on (back up `earth.properties` first and restore it after):
- Start Collect Earth, open a plot. The window list (scratchpad `windows.ps1`) shows the plots map and one imagery
  window; its tabs are Google Earth Web, Wayback, extra map.
- Next plot, three times: the tab shown does not change; switching tabs shows each source on the new plot.
- Click the Wayback button in the plots map: the tab comes to the front and the window over the others; the button
  follows when a tab is clicked in the browser.
- Close the Wayback tab, next plot: it opens again. Close the imagery window, next plot: it opens again and is laid out.
- One screen and two screens (Arrange in the main window).
- The classic viewer with Wayback: one browser window with its tab.
- The log has no ERROR, `earth_error.log` no new entries.

**Step 4: Commit** — `"Changelog: the imagery in one window, a tab per source"`.

---

## After the plan

Use `@superpowers:finishing-a-development-branch`: merge `feature/tabbed-imagery` back into `feature/gew-viewer` (or a
PR), and remove the worktree.
