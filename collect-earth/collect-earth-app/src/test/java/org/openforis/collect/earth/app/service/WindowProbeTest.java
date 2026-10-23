package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.openforis.collect.earth.app.service.WindowLayoutService.WindowState;

public class WindowProbeTest {

	private final WindowProbe probe = new WindowProbe("test probe", Duration.ofMillis(200));

	@AfterEach
	public void stop() {
		probe.shutdown();
	}

	@Test
	public void anAnswerIsGiven() {
		assertEquals(WindowState.OPEN, probe.check(() -> WindowState.OPEN));
		assertEquals(WindowState.CLOSED, probe.check(() -> WindowState.CLOSED));
	}

	@Test
	public void aCheckThatFailsIsNoAnswer() {
		assertEquals(WindowState.NO_ANSWER, probe.check(() -> {
			throw new IllegalStateException("odd");
		}));
	}

	@Test
	@Timeout(5)
	public void aHungBrowserIsNotWaitedForAndNotAskedAgainMeanwhile() throws Exception {
		CountDownLatch hung = new CountDownLatch(1);
		AtomicInteger calls = new AtomicInteger();
		assertEquals(WindowState.NO_ANSWER, probe.check(() -> {
			calls.incrementAndGet();
			hung.await();
			return WindowState.OPEN;
		}));
		assertEquals(WindowState.NO_ANSWER, probe.check(() -> {
			calls.incrementAndGet();
			return WindowState.OPEN;
		}));
		assertEquals(1, calls.get());
		hung.countDown();
		Thread.sleep(50);
		assertEquals(WindowState.OPEN, probe.check(() -> WindowState.OPEN));
	}
}
