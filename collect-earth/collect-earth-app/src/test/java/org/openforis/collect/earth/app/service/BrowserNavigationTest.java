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

import org.junit.jupiter.api.Test;
import org.openqa.selenium.NoSuchWindowException;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.remote.RemoteWebDriver;

/**
 * {@link BrowserService#navigateTo} with a window that is gone: the window opened instead is of the kind the caller
 * had (the plots map's is an app window), and the driver of the one gone is quit and forgotten.
 */
public class BrowserNavigationTest {

	/** A browser window that records what it is asked; gone, it says "no such window" to a navigation. */
	static class FakeWindow extends RemoteWebDriver {
		final List<String> calls = Collections.synchronizedList(new ArrayList<>());
		final boolean gone;

		FakeWindow(boolean gone) {
			this.gone = gone;
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
}
