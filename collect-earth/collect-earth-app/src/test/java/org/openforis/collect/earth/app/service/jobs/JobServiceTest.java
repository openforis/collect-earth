package org.openforis.collect.earth.app.service.jobs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

public class JobServiceTest {

	/** The clock of the service, which the tests move instead of waiting for it */
	private final AtomicLong now = new AtomicLong(1_000_000L);
	private final JobService jobs = new JobService(now::get);

	@AfterEach
	public void stop() {
		jobs.shutdown();
	}

	private Map<String, Object> waitUntilOver(String id) throws InterruptedException {
		for (int i = 0; i < 100; i++) {
			Map<String, Object> job = jobs.get(id);
			if (!"RUNNING".equals(job.get("state"))) {
				return job;
			}
			Thread.sleep(50);
		}
		throw new AssertionError("still running");
	}

	@Test
	public void reportsProgressMessagesAndResult() throws Exception {
		String id = jobs.start("export", ctx -> {
			ctx.progress(50, "half way");
			ctx.message("12 records");
			return "C:/out/export.csv";
		});
		Map<String, Object> job = waitUntilOver(id);
		assertEquals("DONE", job.get("state"));
		assertEquals(100, job.get("progress"));
		assertEquals("C:/out/export.csv", job.get("result"));
		assertTrue(((List<?>) job.get("messages")).contains("12 records"));
	}

	@Test
	public void aFailureKeepsItsMessages() throws Exception {
		String id = jobs.start("export", ctx -> {
			ctx.message("read 3 plots");
			throw new IllegalStateException("disk full");
		});
		Map<String, Object> job = waitUntilOver(id);
		assertEquals("FAILED", job.get("state"));
		assertEquals("disk full", job.get("error"));
		assertTrue(((List<?>) job.get("messages")).contains("read 3 plots"));
	}

	@Test
	public void aFailureWithNoMessageSaysWhatFailed() throws Exception {
		String id = jobs.start("export", ctx -> {
			throw new NullPointerException();
		});
		// the class, as ApiExceptionHandler says it, as a NullPointerException often has no message
		assertEquals(NullPointerException.class.getName(), waitUntilOver(id).get("error"));
	}

	@Test
	public void canBeCancelled() throws Exception {
		CountDownLatch started = new CountDownLatch(1);
		String id = jobs.start("export", ctx -> {
			started.countDown();
			while (!ctx.isCancelled()) {
				Thread.sleep(10);
			}
			return null;
		});
		assertTrue(started.await(2, TimeUnit.SECONDS));
		jobs.cancel(id);
		assertEquals("CANCELLED", waitUntilOver(id).get("state"));
	}

	@Test
	public void oneJobOfAKindAtATime() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		jobs.start("export", ctx -> {
			release.await();
			return null;
		});
		assertThrows(IllegalStateException.class, () -> jobs.start("export", ctx -> null));
		assertNotNull(jobs.start("import", ctx -> null));
		release.countDown();
	}

	@Test
	public void anUnknownJobIsNull() {
		assertNull(jobs.get("nope"));
	}

	@Test
	public void aFinishedJobIsForgottenAfterAWhile() throws Exception {
		String id = jobs.start("export", ctx -> "done");
		waitUntilOver(id);
		now.addAndGet(TimeUnit.MINUTES.toMillis(JobService.FORGET_AFTER_MINUTES) - 1);
		assertNotNull(jobs.get(id));
		now.addAndGet(2);
		// read, not another start: a job started once must not be kept forever because no other one starts
		assertNull(jobs.get(id));
	}

	@Test
	public void aRunningJobIsNeverForgotten() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		String id = jobs.start("export", ctx -> {
			release.await();
			return null;
		});
		now.addAndGet(TimeUnit.MINUTES.toMillis(JobService.FORGET_AFTER_MINUTES) * 10);
		assertNotNull(jobs.get(id));
		release.countDown();
	}
}
