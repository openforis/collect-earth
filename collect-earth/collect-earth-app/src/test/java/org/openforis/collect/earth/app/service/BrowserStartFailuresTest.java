package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.Test;
import org.openqa.selenium.SessionNotCreatedException;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.remote.NoSuchDriverException;

public class BrowserStartFailuresTest {

	private final AtomicLong now = new AtomicLong(1_000);
	private final BrowserStartFailures failures = new BrowserStartFailures(now::get, Duration.ofNanos(60));

	@Test
	public void nothingFailedYet() {
		assertFalse(failures.failedRecently());
	}

	@Test
	public void aFailedStartIsRememberedForAWhile() {
		failures.failed();
		now.addAndGet(59);
		assertTrue(failures.failedRecently());
		now.addAndGet(1);
		assertFalse(failures.failedRecently());
	}

	@Test
	public void aStartThatWorksForgetsTheFailure() {
		failures.failed();
		failures.started();
		assertFalse(failures.failedRecently());
	}

	@Test
	public void theLatestFailureCounts() {
		failures.failed();
		now.addAndGet(50);
		failures.failed();
		now.addAndGet(50);
		assertTrue(failures.failedRecently());
	}

	@Test
	public void aBrowserThatIsNotInstalledIsToldApart() {
		assertTrue(BrowserStartFailures.isNotInstalled(new NoSuchDriverException("Unable to obtain: chromedriver")));
		assertTrue(BrowserStartFailures.isNotInstalled(
				new SessionNotCreatedException("session not created: unknown error: cannot find Chrome binary")));
		assertTrue(BrowserStartFailures.isNotInstalled(
				new SessionNotCreatedException("session not created: no chrome binary at C:\\chrome.exe")));
		assertTrue(BrowserStartFailures.isNotInstalled(new IllegalStateException("wrapped",
				new WebDriverException("unknown error: cannot find msedge binary"))));
		assertTrue(BrowserStartFailures.isNotInstalled(new SessionNotCreatedException(
				"Expected browser binary location, but unable to find binary in default location")));
	}

	@Test
	public void otherFailuresMayBeAboutTheProfile() {
		assertFalse(BrowserStartFailures.isNotInstalled(new SessionNotCreatedException(
				"session not created: probably user data directory is already in use")));
		assertFalse(BrowserStartFailures.isNotInstalled(
				new SessionNotCreatedException("Process unexpectedly closed with status 0")));
		assertFalse(BrowserStartFailures.isNotInstalled(new RuntimeException((String) null)));
	}
}
