package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.ConnectException;
import java.net.SocketException;

import org.junit.jupiter.api.Test;
import org.openqa.selenium.NoSuchSessionException;
import org.openqa.selenium.NoSuchWindowException;
import org.openqa.selenium.TimeoutException;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.remote.UnreachableBrowserException;

/** Which failures of a window check mean that the window is gone ({@link WindowLayoutService#meansClosed}). */
public class WindowStateTest {

	@Test
	public void aSessionOrWindowThatIsGoneIsClosed() {
		assertTrue(WindowLayoutService.meansClosed(new NoSuchSessionException("invalid session id")));
		assertTrue(WindowLayoutService.meansClosed(new NoSuchWindowException("target window already closed")));
		assertTrue(WindowLayoutService.meansClosed(
				new WebDriverException("wrapped", new NoSuchSessionException("session deleted"))));
	}

	@Test
	public void aDriverThatNoLongerAnswersIsClosed() {
		assertTrue(WindowLayoutService.meansClosed(
				new UnreachableBrowserException("gone", new ConnectException("Connection refused: no further information"))));
		assertTrue(WindowLayoutService.meansClosed(new WebDriverException(new SocketException("Connection reset"))));
	}

	@Test
	public void anyOtherFailureIsNotTakenAsClosed() {
		assertFalse(WindowLayoutService.meansClosed(new WebDriverException("unknown error: cannot determine loading status")));
		assertFalse(WindowLayoutService.meansClosed(new TimeoutException("no answer")));
		assertFalse(WindowLayoutService.meansClosed(new WebDriverException(new SocketException("Read timed out"))));
	}
}
