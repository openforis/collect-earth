package org.openforis.collect.earth.app.service.jobs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.jobs.JobService.Cancellation;

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
		assertEquals(Cancellation.REQUESTED, jobs.cancel(id));
		assertEquals("CANCELLED", waitUntilOver(id).get("state"));
	}

	@Test
	public void aJobThatThrowsOnceCancelledIsCancelled() throws Exception {
		// services often report that they saw the flag by throwing
		CountDownLatch started = new CountDownLatch(1);
		String id = jobs.start("export", ctx -> {
			started.countDown();
			while (!ctx.isCancelled()) {
				Thread.sleep(10);
			}
			throw new IllegalStateException("export cancelled");
		});
		assertTrue(started.await(2, TimeUnit.SECONDS));
		jobs.cancel(id);
		Map<String, Object> job = waitUntilOver(id);
		assertEquals("CANCELLED", job.get("state"));
		assertEquals("export cancelled", job.get("error"));
	}

	@Test
	public void aJobThatIsOverCannotBeCancelled() throws Exception {
		String id = jobs.start("export", ctx -> "done");
		waitUntilOver(id);
		assertEquals(Cancellation.OVER, jobs.cancel(id));
		assertEquals("DONE", jobs.get(id).get("state"));
		assertEquals(Cancellation.UNKNOWN, jobs.cancel("nope"));
	}

	@Test
	public void anErrorEndsTheJob() throws Exception {
		// as when a library is missing from earth-libs
		String id = jobs.start("export", ctx -> {
			throw new NoClassDefFoundError("org/geotools/Missing");
		});
		Map<String, Object> job = waitUntilOver(id);
		assertEquals("FAILED", job.get("state"));
		assertEquals("org/geotools/Missing", job.get("error"));
	}

	@Test
	public void anErrorOfTheVirtualMachineEndsTheJobToo() throws Exception {
		// rethrown after it is recorded, for the uncaught exception handler (Sentry's): this prints its stack trace
		String id = jobs.start("export", ctx -> {
			throw new OutOfMemoryError("Java heap space");
		});
		assertEquals("FAILED", waitUntilOver(id).get("state"));
		assertNotNull(jobs.start("export", ctx -> null));
	}

	@Test
	public void aJobThatCannotStartLeavesNothingBehind() {
		jobs.shutdown();
		assertThrows(RejectedExecutionException.class, () -> jobs.start("export", ctx -> null));
		// not IllegalStateException: the first one is not left RUNNING, holding its kind for ever
		assertThrows(RejectedExecutionException.class, () -> jobs.start("export", ctx -> null));
	}

	@Test
	public void onlyTheLastMessagesAreKept() throws Exception {
		String id = jobs.start("import", ctx -> {
			for (int i = 0; i < JobService.MAX_MESSAGES + 100; i++) {
				ctx.message("line " + i);
			}
			return null;
		});
		List<?> messages = (List<?>) waitUntilOver(id).get("messages");
		assertEquals(JobService.MAX_MESSAGES, messages.size());
		assertEquals("line 100", messages.get(0));
		assertEquals("line " + (JobService.MAX_MESSAGES + 99), messages.get(messages.size() - 1));
	}

	@Test
	public void theThreadIsNamedAfterTheKindOfJob() throws Exception {
		// so a thread dump, or the log, says which job a thread runs
		String id = jobs.start("saiku", ctx -> Thread.currentThread().getName());
		assertEquals("Collect Earth job saiku", waitUntilOver(id).get("result"));
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
