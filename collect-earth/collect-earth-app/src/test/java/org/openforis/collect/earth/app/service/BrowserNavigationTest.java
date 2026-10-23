package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.openqa.selenium.NoSuchSessionException;
import org.openqa.selenium.NoSuchWindowException;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.remote.RemoteWebDriver;

/**
 * {@link BrowserService#navigateTo} with a window that is gone: the window opened instead is of the kind the caller
 * had (the plots map's is an app window), and the driver of the one gone is quit and forgotten. A window that is still
 * there (an alert open, another tab left) is not quit.
 */
public class BrowserNavigationTest {

	/** A browser window that records what it is asked; gone, it says "no such window" to a navigation. */
	static class FakeWindow extends RemoteWebDriver {
		final List<String> calls = Collections.synchronizedList(new ArrayList<>());
		/** Whether a navigation fails with "no such window". */
		final boolean gone;
		/** The windows of its browser: none once the user closed the last. */
		Set<String> handles;

		FakeWindow(boolean gone) {
			this.gone = gone;
			this.handles = gone ? Collections.emptySet() : Collections.singleton("window");
		}

		@Override
		public Set<String> getWindowHandles() {
			return handles;
		}

		@Override
		public Navigation navigate() {
			return (Navigation) Proxy.newProxyInstance(Navigation.class.getClassLoader(),
					new Class<?>[] { WebDriver.Navigation.class }, (proxy, method, args) -> {
						if (gone) {
							throw new NoSuchWindowException("no such window: target window already closed");
						}
						calls.add(method.getName() + (args == null ? "" : " " + args[0]));
						return null;
					});
		}

		@Override
		public void quit() {
			calls.add("quit");
		}
	}

	/** The browser service, taking a window for working unless told it is not. */
	static class TestBrowserService extends BrowserService {
		final List<RemoteWebDriver> notWorking = new ArrayList<>();

		@Override
		protected boolean isDriverWorking(RemoteWebDriver driver) {
			return !notWorking.contains(driver);
		}
	}

	@Test
	public void aWindowClosedAsThePageLoadsIsReplacedByOneOfTheSameKind() throws Exception {
		TestBrowserService service = new TestBrowserService();
		FakeWindow closed = new FakeWindow(true);
		FakeWindow opened = new FakeWindow(false);
		List<String> opens = new ArrayList<>();
		RemoteWebDriver result = service.navigateTo("http://localhost/map", closed, true, false, () -> {
			opens.add("app window");
			return opened;
		});
		assertSame(opened, result);
		assertEquals(Arrays.asList("app window"), opens);
		assertEquals(Arrays.asList("to http://localhost/map"), opened.calls);
		assertTrue(closed.calls.contains("quit"), closed.calls.toString());
		assertFalse(service.isKept(closed));
	}

	@Test
	public void aWindowFoundGoneBeforeTheLoadIsQuitAndReplaced() throws Exception {
		TestBrowserService service = new TestBrowserService();
		FakeWindow gone = new FakeWindow(true);
		service.notWorking.add(gone);
		FakeWindow opened = new FakeWindow(false);
		RemoteWebDriver result = service.navigateTo("http://localhost/map", gone, true, true, () -> opened);
		assertSame(opened, result);
		assertEquals(Arrays.asList("to http://localhost/map", "refresh"), opened.calls);
		assertEquals(Arrays.asList("quit"), gone.calls);
	}

	@Test
	public void aWindowThatDoesNotAnswerButIsThereIsNotQuit() throws Exception {
		TestBrowserService service = new TestBrowserService();
		// An alert open, or a page with no body yet: findElement fails, the window is there
		FakeWindow busy = new FakeWindow(false);
		service.notWorking.add(busy);
		FakeWindow opened = new FakeWindow(false);
		RemoteWebDriver result = service.navigateTo("http://localhost/balloon", busy, false, false, () -> opened);
		assertSame(opened, result);
		assertFalse(busy.calls.contains("quit"), busy.calls.toString());
	}

	@Test
	public void aClosedTabOfAWindowLeftOpenIsNotQuit() throws Exception {
		TestBrowserService service = new TestBrowserService();
		FakeWindow tabClosed = new FakeWindow(true);
		tabClosed.handles = Collections.singleton("another tab");
		FakeWindow opened = new FakeWindow(false);
		RemoteWebDriver result = service.navigateTo("http://localhost/map", tabClosed, true, false, () -> opened);
		assertSame(opened, result);
		assertFalse(tabClosed.calls.contains("quit"), tabClosed.calls.toString());
	}

	@Test
	public void aBrowserThatIsGoneIsQuit() throws Exception {
		TestBrowserService service = new TestBrowserService();
		FakeWindow ended = new FakeWindow(true) {
			@Override
			public Set<String> getWindowHandles() {
				throw new NoSuchSessionException("Session not found");
			}
		};
		service.notWorking.add(ended);
		service.navigateTo("http://localhost/map", ended, true, false, () -> new FakeWindow(false));
		assertTrue(ended.calls.contains("quit"), ended.calls.toString());
	}
}
