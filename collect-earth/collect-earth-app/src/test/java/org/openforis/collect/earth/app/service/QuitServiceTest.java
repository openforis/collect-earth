package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;

/** Quitting, with the server stop and the exit of the process stood in for. */
public class QuitServiceTest {

	private final List<String> steps = new CopyOnWriteArrayList<>();
	private final CountDownLatch exited = new CountDownLatch(1);

	private void exit() {
		steps.add("exit");
		exited.countDown();
	}

	@Test
	public void theServerStopsBeforeTheProcessExits() throws Exception {
		new QuitService(() -> steps.add("stop"), this::exit, 2000).run();
		assertTrue(exited.await(2, TimeUnit.SECONDS));
		assertEquals(List.of("stop", "exit"), steps);
	}

	@Test
	public void runAnswersBeforeTheServerHasStopped() throws Exception {
		// The request that asked to quit has to be answered: run() must not wait for the stop or the exit
		CountDownLatch release = new CountDownLatch(1);
		new QuitService(() -> await(release), this::exit, 2000).run();
		assertFalse(steps.contains("exit"));
		release.countDown();
		assertTrue(exited.await(2, TimeUnit.SECONDS));
	}

	@Test
	public void theProcessExitsWhenTheServerDoesNotStopInTime() throws Exception {
		CountDownLatch never = new CountDownLatch(1);
		new QuitService(() -> await(never), this::exit, 100).run();
		assertTrue(exited.await(2, TimeUnit.SECONDS));
		never.countDown();
	}

	@Test
	public void theProcessExitsWhenTheServerFailsToStop() throws Exception {
		new QuitService(() -> {
			throw new IllegalStateException("simulated failure to stop");
		}, this::exit, 2000).run();
		assertTrue(exited.await(2, TimeUnit.SECONDS));
	}

	@Test
	public void aSecondQuitDoesNothingMore() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		QuitService quit = new QuitService(() -> {
			steps.add("stop");
			await(release);
		}, this::exit, 2000);
		quit.run();
		quit.run();
		release.countDown();
		assertTrue(exited.await(2, TimeUnit.SECONDS));
		Thread.sleep(200);
		assertEquals(List.of("stop", "exit"), steps);
	}

	private static void await(CountDownLatch latch) {
		try {
			latch.await(5, TimeUnit.SECONDS);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}
}
