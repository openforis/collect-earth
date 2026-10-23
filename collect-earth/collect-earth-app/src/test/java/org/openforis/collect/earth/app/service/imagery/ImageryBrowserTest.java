package org.openforis.collect.earth.app.service.imagery;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.remote.RemoteWebDriver;

import io.sentry.SentryLevel;

public class ImageryBrowserTest {

	private final FakeTabDriver browser = new FakeTabDriver();
	private int starts;
	private final ImageryErrorReporterTest.RecordingReporter reporter = new ImageryErrorReporterTest.RecordingReporter();
	private final ImageryBrowser imagery = new ImageryBrowser(() -> { starts++; return browser; }, reporter);

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
	public void theTabTheBrowserOpenedWithIsTheVisibleOne() {
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		assertEquals(ImagerySource.PLANET, imagery.visibleSource());
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
	public void aClosedVisibleTabIsNoLongerVisible() {
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		browser.close("tab0");
		assertNull(imagery.visibleSource());
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

	@Test
	public void aCheckOfAClosedBrowserDoesNotStartANewOne() {
		imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("https://gew/1");
		browser.alive = false;
		assertThrows(TabClosedException.class,
				() -> imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).evaluateIfOpen("return 1;"));
		assertEquals(1, starts);
		assertFalse(browser.calls.contains("evaluate tab0"), browser.calls.toString());
	}

	@Test
	public void aCheckOfASourceWithoutATabNeitherStartsTheBrowserNorOpensTheTab() {
		assertThrows(TabClosedException.class, () -> imagery.tab(ImagerySource.PLANET).evaluateIfOpen("return 1;"));
		assertEquals(0, starts);
		imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("https://gew/1");
		assertThrows(TabClosedException.class, () -> imagery.tab(ImagerySource.PLANET).evaluateIfOpen("return 1;"));
		assertFalse(browser.calls.stream().anyMatch(call -> call.startsWith("create")), browser.calls.toString());
	}

	@Test
	public void aCheckOfAnOpenTabRunsInIt() {
		imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("https://gew/1");
		imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).evaluateIfOpen("return 1;");
		assertTrue(browser.calls.contains("evaluate tab0"), browser.calls.toString());
	}

	@Test
	public void theSourcesOfAClosedBrowserAreNotListedAsOpen() {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.PLANET));
		browser.alive = false;
		assertEquals(Collections.emptyList(), imagery.openSources());
	}

	@Test
	public void aClosedBrowserIsQuitBeforeANewOneStarts() {
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		browser.alive = false; // the user closed the window: its driver service is still running
		imagery.setStarter(FakeTabDriver::new);
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/2");
		assertTrue(browser.calls.contains("quit"), browser.calls.toString());
	}

	@Test
	@Timeout(10)
	public void aBrowserStillStartingAtShutdownIsQuit() throws Exception {
		CountDownLatch starting = new CountDownLatch(1);
		CountDownLatch started = new CountDownLatch(1);
		imagery.setStarter(() -> {
			starting.countDown();
			await(started);
			return browser;
		});
		imagery.setShutdownWait(Duration.ofMillis(100));
		AtomicReference<RuntimeException> failure = new AtomicReference<>();
		Thread caller = new Thread(() -> {
			try {
				imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
			} catch (RuntimeException e) {
				failure.set(e);
			}
		});
		caller.start();
		await(starting);
		imagery.shutdown(); // gives up waiting for the start
		started.countDown();
		caller.join();
		assertTrue(failure.get() instanceof IllegalStateException, String.valueOf(failure.get()));
		assertTrue(browser.calls.contains("quit"), browser.calls.toString());
		assertFalse(browser.calls.contains("navigate tab0 https://planet/1"), browser.calls.toString());
	}

	@Test
	@Timeout(10)
	public void aHungBrowserIsQuitReportedAndStartedAgain() {
		imagery.setCommandTimeout(Duration.ofMillis(300));
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/0");
		browser.holdFirstNavigate = new CountDownLatch(1); // never released: the browser hangs
		FakeTabDriver second = new FakeTabDriver();
		imagery.setStarter(() -> second);
		assertThrows(IllegalStateException.class, () -> imagery.tab(ImagerySource.PLANET).navigate("https://planet/1"));
		assertTrue(browser.calls.contains("quit"), browser.calls.toString());
		assertEquals("command_timeout", reporter.sent.get(0).get("imagery.error"));
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/2");
		assertEquals(Arrays.asList("navigate tab0 https://planet/2"), second.calls);
	}

	@Test
	@Timeout(10)
	public void aBrowserHungOpeningATabIsQuitByTheNextCallerThatGivesUp() throws Exception {
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/0");
		browser.holdCreateTab = new CountDownLatch(1); // never released: the browser hangs
		// Its caller is interrupted well before, however slow the machine: it is then waiting for the result
		imagery.setCommandTimeout(Duration.ofSeconds(2));
		Thread opening = new Thread(() -> {
			try {
				imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("https://gew/1");
			} catch (RuntimeException e) {
				// interrupted: this caller leaves without dealing with the hang
			}
		});
		opening.start();
		await(browser.enteredHeldCreateTab);
		waitFor(() -> opening.getState() == Thread.State.TIMED_WAITING);
		opening.interrupt();
		opening.join();
		FakeTabDriver second = new FakeTabDriver();
		imagery.setStarter(() -> second);
		imagery.setCommandTimeout(Duration.ofSeconds(3));
		// Queued behind the hung command, which by then has run for longer than its own timeout
		assertThrows(IllegalStateException.class,
				() -> imagery.tab(ImagerySource.ESRI_WAYBACK).navigate("https://wayback/1"));
		assertEquals(1, Collections.frequency(browser.calls, "quit"), browser.calls.toString());
		assertEquals(1, reporter.sent.size(), reporter.sent.toString());
		assertEquals("command_timeout", reporter.sent.get(0).get("imagery.error"));
		assertEquals("GOOGLE_EARTH_WEB", reporter.sent.get(0).get("imagery.source"));
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/2");
		assertEquals(Arrays.asList("navigate tab0 https://planet/2"), second.calls);
	}

	@Test
	@Timeout(10)
	public void aCommandThatTimesOutWaitingBehindAHungOneQuitsNothing() throws Exception {
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/0");
		CountDownLatch hold = new CountDownLatch(1);
		browser.holdFirstNavigate = hold;
		AtomicReference<RuntimeException> hungFailure = new AtomicReference<>();
		Thread hung = new Thread(() -> {
			try {
				imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
			} catch (RuntimeException e) {
				hungFailure.set(e);
			}
		});
		hung.start();
		await(browser.enteredHeldNavigate);
		imagery.setCommandTimeout(Duration.ofMillis(200)); // the one behind gives up first
		assertThrows(IllegalStateException.class,
				() -> imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("https://gew/1"));
		// It never ran: the browser it would have quit is not the one to blame, nor is it reported
		assertFalse(browser.calls.contains("quit"), browser.calls.toString());
		assertTrue(reporter.sent.isEmpty(), reporter.sent.toString());
		hold.countDown();
		hung.join();
		assertNull(hungFailure.get());
		assertTrue(browser.calls.contains("navigate tab0 https://planet/1"), browser.calls.toString());
		assertFalse(browser.calls.contains("navigate tab1 https://gew/1"), browser.calls.toString());
	}

	@Test
	public void aScriptGetsItsArgumentsAndReturnsJson() {
		assertEquals("(() => { const r = (function () {return arguments[0] + 1;\n}).apply(null, [41]); "
				+ "return JSON.stringify(r === undefined ? null : r); })()",
				ImageryTab.expression("return arguments[0] + 1;", 41));
		browser.answers.put("location.href", "\"https://earth.google.com/web/\"");
		assertEquals("https://earth.google.com/web/", imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).currentUrl());
	}

	@Test
	public void aPageThatRefusesScriptsIsStillLoaded() {
		browser.failingScripts.add("__collectEarthLeaving = true"); // an error page, a privileged page
		browser.answers.put("readyState", "true");
		assertTrue(imagery.tab(ImagerySource.PLANET).load("https://planet/1", false, Duration.ofSeconds(5)));
		assertTrue(browser.calls.contains("navigate tab0 https://planet/1"), browser.calls.toString());
	}

	@Test
	public void aDocumentBeingReplacedIsWaitedFor() {
		browser.failNextEvaluates = 1;
		browser.answers.put("ready", "true");
		assertTrue(imagery.tab(ImagerySource.PLANET).waitUntil("return ready;", Duration.ofSeconds(5)));
		// Every page load does that: not a fault
		assertTrue(reporter.sent.isEmpty(), reporter.sent.toString());
	}

	@Test
	public void aPageTooBusyToRunAScriptIsNotReported() {
		// Google Earth Web starting: Firefox did not run the script before the BiDi answer was due
		PageScriptException busy = assertThrows(PageScriptException.class, () -> imagery.call(ImagerySource.GOOGLE_EARTH_WEB,
				(d, t) -> {
					throw PageScriptException.pageBusy("no answer in time");
				}));
		assertTrue(busy.isPageBusy());
		assertTrue(reporter.sent.isEmpty(), reporter.sent.toString());
	}

	@Test
	public void aScriptThatThrowsInThePageIsReportedOnce() {
		browser.failingScripts.add("overlay()");
		ImageryTab tab = imagery.tab(ImagerySource.GOOGLE_EARTH_WEB);
		assertThrows(PageScriptException.class, () -> tab.evaluate("return overlay();"));
		assertThrows(PageScriptException.class, () -> tab.evaluate("return overlay();"));
		assertEquals(1, reporter.sent.size(), reporter.sent.toString());
		assertEquals("page_script", reporter.sent.get(0).get("imagery.error"));
		assertEquals("GOOGLE_EARTH_WEB", reporter.sent.get(0).get("imagery.source"));
	}

	@Test
	public void aFailedBidiCommandIsReported() {
		assertThrows(BidiCommandException.class, () -> imagery.call(ImagerySource.ESRI_WAYBACK, (d, tab) -> {
			throw new BidiCommandException("no answer", null);
		}));
		assertEquals(1, reporter.sent.size(), reporter.sent.toString());
		assertEquals("bidi_command", reporter.sent.get(0).get("imagery.error"));
		assertEquals("ESRI_WAYBACK", reporter.sent.get(0).get("imagery.source"));
	}

	@Test
	public void aClosedTabIsNotReported() {
		assertThrows(TabClosedException.class, () -> imagery.call(ImagerySource.PLANET, (d, tab) -> {
			throw new TabClosedException("closed by the user", null);
		}));
		assertTrue(reporter.sent.isEmpty(), reporter.sent.toString());
		assertFalse(imagery.openSources().contains(ImagerySource.PLANET));
	}

	@Test
	@Timeout(10)
	public void aSlowStartOfTheBrowserIsNotAHang() throws Exception {
		CountDownLatch started = new CountDownLatch(1);
		CountDownLatch starting = new CountDownLatch(1);
		imagery.setStarter(() -> {
			starting.countDown();
			await(started);
			return browser;
		});
		// The command that starts the browser keeps the default timeout: with a short one it could be given up while
		// still queued, and the browser would never start
		AtomicReference<RuntimeException> firstFailure = new AtomicReference<>();
		Thread first = new Thread(() -> {
			try {
				imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
			} catch (RuntimeException e) {
				firstFailure.set(e);
			}
		});
		first.start();
		await(starting);
		// Sent during the start, with a timeout well below how long the start takes
		imagery.setCommandTimeout(Duration.ofMillis(500));
		Thread slowStart = new Thread(() -> {
			try {
				Thread.sleep(1500);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
			started.countDown();
		});
		slowStart.start();
		imagery.tab(ImagerySource.ESRI_WAYBACK).navigate("https://wayback/1");
		first.join();
		slowStart.join();
		assertNull(firstFailure.get());
		assertEquals(Arrays.asList("navigate tab0 https://planet/1", "create tab1", "navigate tab1 https://wayback/1"),
				browser.calls);
		assertTrue(reporter.sent.isEmpty(), reporter.sent.toString());
	}

	@Test
	@Timeout(10)
	public void aStartOverItsLimitFailsTheCallersAndIsReportedOnce() throws Exception {
		CountDownLatch started = new CountDownLatch(1);
		CountDownLatch starting = new CountDownLatch(1);
		imagery.setStarter(() -> {
			starting.countDown();
			await(started);
			return browser;
		});
		// The limit of the start is what fails the callers. The first command's timeout is not short, or it could be
		// given up while still queued and the browser would never start; nor the default, as a caller that sent its
		// command before the start began only looks at the start once its own timeout has passed
		imagery.setCommandTimeout(Duration.ofSeconds(2));
		imagery.setStartTimeout(Duration.ofMillis(500));
		AtomicReference<RuntimeException> otherFailure = new AtomicReference<>();
		Thread other = new Thread(() -> {
			try {
				await(starting);
				imagery.tab(ImagerySource.ESRI_WAYBACK).navigate("https://wayback/1");
			} catch (RuntimeException e) {
				otherFailure.set(e);
			}
		});
		other.start();
		IllegalStateException failure = assertThrows(IllegalStateException.class,
				() -> imagery.tab(ImagerySource.PLANET).navigate("https://planet/1"));
		other.join();
		started.countDown();
		assertTrue(failure.getMessage().contains("did not start"), failure.getMessage());
		assertTrue(otherFailure.get().getMessage().contains("did not start"), String.valueOf(otherFailure.get()));
		assertEquals(1, reporter.sent.size(), reporter.sent.toString());
		assertEquals("browser_start_slow", reporter.sent.get(0).get("imagery.error"));
		assertEquals(SentryLevel.WARNING, reporter.levels.get(0));
		assertFalse(browser.calls.contains("quit"), browser.calls.toString());
	}

	@Test
	@Timeout(10)
	public void theListenersHearOfChangesOfTheVisibleTabOnly() throws Exception {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK));
		List<String> heard = Collections.synchronizedList(new ArrayList<>());
		imagery.onVisibilityChange((source, visible) -> heard.add(source + " " + visible));
		browser.select("tab1");
		browser.select("tab1"); // a page load in a tab reports the same again
		browser.select("tab0");
		waitFor(() -> heard.size() >= 4);
		Thread.sleep(50); // nothing more is coming
		assertEquals(Arrays.asList("GOOGLE_EARTH_WEB false", "ESRI_WAYBACK true", "GOOGLE_EARTH_WEB true",
				"ESRI_WAYBACK false"), heard);
	}

	@Test
	@Timeout(10)
	public void theVisibleTabIsServedFirst() throws Exception {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK, ImagerySource.PLANET));
		browser.select("tab1"); // Wayback shown
		browser.calls.clear();
		CountDownLatch hold = new CountDownLatch(1);
		browser.holdFirstNavigate = hold;
		Thread first = new Thread(() -> imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("gew/0"));
		first.start();
		await(browser.enteredHeldNavigate); // the worker is now inside that navigate
		Thread planet = new Thread(() -> imagery.tab(ImagerySource.PLANET).navigate("planet/1"));
		planet.start();
		waitFor(() -> imagery.queuedCount() == 1);
		Thread wayback = new Thread(() -> imagery.tab(ImagerySource.ESRI_WAYBACK).navigate("wayback/1"));
		wayback.start();
		waitFor(() -> imagery.queuedCount() == 2);
		hold.countDown();
		first.join();
		planet.join();
		wayback.join();
		assertEquals(Arrays.asList("navigate tab0 gew/0", "navigate tab1 wayback/1", "navigate tab2 planet/1"),
				browser.calls);
	}

	@Test
	@Timeout(10)
	public void onlyTheLatestPlotOfASourceIsLoaded() throws Exception {
		List<String> loaded = Collections.synchronizedList(new ArrayList<>());
		CountDownLatch inFirst = new CountDownLatch(1);
		CountDownLatch release = new CountDownLatch(1);
		Thread a = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> {
			loaded.add("1");
			inFirst.countDown();
			await(release);
		}));
		a.start();
		await(inFirst);
		// Plots 2 and 3 arrive while 1 is loading: their callers return at once
		Thread b = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> loaded.add("2")));
		b.start();
		b.join();
		Thread c = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> loaded.add("3")));
		c.start();
		c.join();
		release.countDown();
		a.join();
		assertEquals(Arrays.asList("1", "3"), loaded);
	}

	@Test
	@Timeout(10)
	public void aLoadThatFailsDoesNotStrandTheNextPlot() throws Exception {
		List<String> loaded = Collections.synchronizedList(new ArrayList<>());
		CountDownLatch inFirst = new CountDownLatch(1);
		CountDownLatch release = new CountDownLatch(1);
		AtomicReference<RuntimeException> firstFailure = new AtomicReference<>();
		Thread a = new Thread(() -> {
			try {
				imagery.loadLatest(ImagerySource.PLANET, () -> {
					inFirst.countDown();
					await(release);
					throw new IllegalStateException("plot 1 failed");
				});
			} catch (RuntimeException e) {
				firstFailure.set(e);
			}
		});
		a.start();
		await(inFirst);
		Thread b = new Thread(() -> imagery.loadLatest(ImagerySource.PLANET, () -> loaded.add("2")));
		b.start();
		b.join();
		release.countDown();
		a.join();
		assertEquals(Arrays.asList("2"), loaded);
		assertEquals("plot 1 failed", firstFailure.get().getMessage());
	}

	@Test
	public void theWindowCommandsStayOnTheTabTheBrowserOpenedWithWhileItIsOpen() {
		List<String> switches = classicSession();
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("https://earth/1");
		browser.select("tab1");
		assertSame(browser.classic, imagery.window());
		assertEquals(Collections.emptyList(), switches);
	}

	@Test
	public void theWindowCommandsMoveToTheVisibleTabOnceTheirTabIsClosed() {
		List<String> switches = classicSession();
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("https://earth/1");
		browser.select("tab1");
		browser.close("tab0");
		assertSame(browser.classic, imagery.window());
		assertSame(browser.classic, imagery.window());
		// Once only, and to the tab in front: switching selects the tab in Firefox
		assertEquals(Arrays.asList("tab1"), switches);
	}

	@Test
	public void theWindowCannotBeAddressedWhileNoTabIsKnownToBeShown() {
		List<String> switches = classicSession();
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		browser.close("tab0");
		imagery.tab(ImagerySource.GOOGLE_EARTH_WEB).navigate("https://earth/1");
		assertNull(imagery.window());
		assertEquals(Collections.emptyList(), switches);
	}

	@Test
	@Timeout(10)
	public void everyBrowserStartIsAnnounced() throws Exception {
		CountDownLatch first = new CountDownLatch(1);
		CountDownLatch second = new CountDownLatch(2);
		imagery.onBrowserStarted(() -> {
			first.countDown();
			second.countDown();
		});
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/1");
		await(first);
		browser.alive = false;
		imagery.setStarter(FakeTabDriver::new);
		imagery.tab(ImagerySource.PLANET).navigate("https://planet/2");
		await(second);
	}

	/**
	 * Gives the fake browser a classic session that records the tabs it is switched to. RemoteWebDriver's own
	 * constructor without a session is protected: an anonymous subclass reaches it.
	 */
	private List<String> classicSession() {
		List<String> switches = Collections.synchronizedList(new ArrayList<>());
		WebDriver.TargetLocator locator = (WebDriver.TargetLocator) Proxy.newProxyInstance(
				WebDriver.TargetLocator.class.getClassLoader(), new Class<?>[] { WebDriver.TargetLocator.class },
				(proxy, method, args) -> {
					if (!"window".equals(method.getName())) {
						throw new UnsupportedOperationException(method.getName());
					}
					switches.add((String) args[0]);
					return null;
				});
		browser.classic = new RemoteWebDriver() {
			@Override
			public TargetLocator switchTo() {
				return locator;
			}
		};
		return switches;
	}

	/** Bounded, so that a race in a test fails it instead of leaving a thread waiting for good. */
	private static void await(CountDownLatch latch) {
		try {
			if (!latch.await(5, TimeUnit.SECONDS)) {
				throw new AssertionError("timed out waiting for a latch");
			}
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}

	private static void waitFor(BooleanSupplier condition) throws InterruptedException {
		long end = System.nanoTime() + Duration.ofSeconds(5).toNanos();
		while (!condition.getAsBoolean()) {
			if (System.nanoTime() > end) {
				throw new AssertionError("timed out");
			}
			Thread.sleep(5);
		}
	}

	@Test
	public void theVisibleSourceFollowsTheBrowser() {
		imagery.openTabs(EnumSet.of(ImagerySource.GOOGLE_EARTH_WEB, ImagerySource.ESRI_WAYBACK));
		browser.select("tab1");
		assertEquals(ImagerySource.ESRI_WAYBACK, imagery.visibleSource());
		imagery.show(ImagerySource.GOOGLE_EARTH_WEB);
		assertTrue(browser.calls.contains("activate tab0"));
	}
}
