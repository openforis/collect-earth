package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.remote.RemoteWebDriver;

/**
 * The browsers quit when Collect Earth closes: once, however many times it is asked (the closing of the Spring context
 * and the shutdown hook both ask), with a browser that hangs or fails not keeping the others open or Collect Earth
 * from ending.
 */
public class BrowserQuitTest {

	static class CountingDriver extends RemoteWebDriver {
		final AtomicInteger quits = new AtomicInteger();
		final long hangMillis;
		final boolean fails;

		CountingDriver(long hangMillis, boolean fails) {
			this.hangMillis = hangMillis;
			this.fails = fails;
		}

		@Override
		public void quit() {
			quits.incrementAndGet();
			if (hangMillis > 0) {
				try {
					Thread.sleep(hangMillis);
				} catch (InterruptedException e) {
					Thread.currentThread().interrupt();
				}
			}
			if (fails) {
				throw new WebDriverException("Timed out waiting for driver server to stop.");
			}
		}
	}

	@TempDir
	Path folder;

	private BrowserService service() {
		BrowserService service = new BrowserService();
		service.setLeftoverBrowsers(new LeftoverBrowsers(folder.toFile()));
		return service;
	}

	@Test
	public void aQuitForgetsTheBrowsersWrittenDown() throws Exception {
		BrowserService service = service();
		service.leftoverBrowsers().record(List.of());
		assertTrue(Files.exists(folder.resolve(LeftoverBrowsers.FILE_NAME)));
		service.quitAllBrowsers();
		assertFalse(Files.exists(folder.resolve(LeftoverBrowsers.FILE_NAME)));
	}

	@Test
	public void everyBrowserIsQuitOnceEvenWhenAskedTwiceAtOnce() throws Exception {
		BrowserService service = service();
		CountingDriver slow = new CountingDriver(300, false);
		CountingDriver failing = new CountingDriver(0, true);
		CountingDriver fine = new CountingDriver(0, false);
		service.keep(slow);
		service.keep(failing);
		service.keep(fine);

		CountDownLatch done = new CountDownLatch(2);
		for (int i = 0; i < 2; i++) {
			new Thread(() -> {
				service.quitAllBrowsers();
				done.countDown();
			}).start();
		}
		assertTrue(done.await(10, TimeUnit.SECONDS));
		assertEquals(1, slow.quits.get());
		assertEquals(1, failing.quits.get());
		assertEquals(1, fine.quits.get());
		assertTrue(service.isClosing());
	}

	@Test
	public void aBrowserThatHangsDoesNotHoldTheClosingBeyondItsTime() {
		BrowserService service = service();
		service.keep(new CountingDriver(60_000, false));
		long start = System.currentTimeMillis();
		service.quitAllBrowsers();
		long took = System.currentTimeMillis() - start;
		assertTrue(took < BrowserService.QUIT_BROWSERS_MILLIS + 2000, "took " + took + " ms");
	}

	@Test
	public void onlyDriverServersAreTakenForOnes() {
		// this test's own process is a java, not a driver server
		assertFalse(BrowserService.isDriverServer(ProcessHandle.current()));
		// nothing this test started is one either, so nothing is listed to kill
		assertTrue(BrowserService.driverProcesses().isEmpty());
	}
}
