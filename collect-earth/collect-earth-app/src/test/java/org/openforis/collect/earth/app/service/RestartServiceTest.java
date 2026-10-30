package org.openforis.collect.earth.app.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;

/** Restarting, with the clearing of the checksums and the relaunch stood in for. */
public class RestartServiceTest {

	private final List<String> steps = new CopyOnWriteArrayList<>();
	private final CountDownLatch restarted = new CountDownLatch(1);

	private void restart() {
		steps.add("restart");
		restarted.countDown();
	}

	@Test
	public void theChecksumsAreClearedBeforeTheRestart() throws Exception {
		new RestartService(() -> steps.add("prepare"), this::restart).run();
		assertTrue(restarted.await(2, TimeUnit.SECONDS));
		assertEquals(List.of("prepare", "restart"), steps);
	}

	@Test
	public void runAnswersBeforeTheRestart() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		new RestartService(() -> await(release), this::restart).run();
		assertFalse(steps.contains("restart"));
		release.countDown();
		assertTrue(restarted.await(2, TimeUnit.SECONDS));
	}

	@Test
	public void theRestartGoesOnWhenThePreparationFails() throws Exception {
		new RestartService(() -> {
			throw new IllegalStateException("simulated failure to clear the checksums");
		}, this::restart).run();
		assertTrue(restarted.await(2, TimeUnit.SECONDS));
	}

	@Test
	public void aSecondRestartDoesNothingMore() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		RestartService service = new RestartService(() -> await(release), this::restart);
		service.run();
		service.run();
		release.countDown();
		assertTrue(restarted.await(2, TimeUnit.SECONDS));
		// Give a second thread, if there were one, the time to add its steps
		Thread.sleep(100);
		assertEquals(List.of("restart"), steps);
	}

	private static void await(CountDownLatch latch) {
		try {
			latch.await();
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}
}
