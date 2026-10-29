package org.openforis.collect.earth.app.service.jobs;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

import javax.annotation.PreDestroy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Runs the long actions of the pages (exports, imports, Saiku, IPCC...) on threads of their own and keeps what they
 * report, which the pages read (GET /api/jobs/{id}): the Swing UI blocked in a modal progress dialog instead. One job
 * of each kind at a time, as those dialogs allowed. A job is forgotten FORGET_AFTER_MINUTES after it ended.
 */
@Service
public class JobService {

	static final long FORGET_AFTER_MINUTES = 30;

	private static final String RUNNING = "RUNNING";

	private final Logger logger = LoggerFactory.getLogger(JobService.class);
	private final ExecutorService executor = Executors.newCachedThreadPool(r -> {
		// Daemon threads, so a job still running does not keep the application from closing
		Thread t = new Thread(r, "Collect Earth job");
		t.setDaemon(true);
		return t;
	});
	private final Map<String, Running> jobs = new ConcurrentHashMap<>();
	/** The clock, which the tests move so they do not wait FORGET_AFTER_MINUTES */
	private final LongSupplier now;

	/**
	 * What a job reports while it runs. The worker thread writes state last, after result, progress, error and endedAt,
	 * and get() reads it first: as all of them are volatile, a reader that sees a final state sees everything written
	 * before it, and never DONE with the progress of before.
	 */
	private static final class Running implements JobContext {
		final String kind;
		volatile String state = RUNNING;
		volatile int progress;
		volatile String step;
		final List<String> messages = Collections.synchronizedList(new ArrayList<>());
		volatile Object result;
		volatile String error;
		volatile boolean cancelled;
		/** 0 while it runs */
		volatile long endedAt;

		Running(String kind) {
			this.kind = kind;
		}

		@Override
		public void progress(int percent, String step) {
			this.progress = percent;
			this.step = step;
		}

		@Override
		public void message(String line) {
			messages.add(line);
		}

		@Override
		public boolean isCancelled() {
			return cancelled;
		}
	}

	public JobService() {
		this(System::currentTimeMillis);
	}

	JobService(LongSupplier now) {
		this.now = now;
	}

	/**
	 * @return the id of the job
	 * @throws IllegalStateException when a job of the same kind still runs
	 */
	public synchronized String start(String kind, Job job) {
		forgetOld();
		for (Running running : jobs.values()) {
			if (running.kind.equals(kind) && RUNNING.equals(running.state)) {
				throw new IllegalStateException("A job of kind " + kind + " is running already");
			}
		}
		String id = UUID.randomUUID().toString();
		Running running = new Running(kind);
		jobs.put(id, running);
		executor.execute(() -> run(kind, job, running));
		return id;
	}

	private void run(String kind, Job job, Running running) {
		String state;
		try {
			running.result = job.run(running);
			if (running.cancelled) {
				state = "CANCELLED";
			} else {
				running.progress = 100;
				state = "DONE";
			}
		} catch (InterruptedException e) {
			state = "CANCELLED";
			Thread.currentThread().interrupt();
		} catch (Throwable e) {
			// Throwable, not Exception: a job ended by an Error (a class missing from earth-libs) would otherwise stay
			// RUNNING for ever, and no other job of its kind could start until the application is restarted
			logger.error("The job {} failed", kind, e);
			// the class says something when the exception has no message, as in ApiExceptionHandler
			running.error = e.getMessage() != null ? e.getMessage() : e.getClass().getName();
			state = "FAILED";
		}
		running.endedAt = now.getAsLong();
		running.state = state;
	}

	/** The job as the page reads it, or null when there is none of that id (never, or forgotten). */
	public Map<String, Object> get(String id) {
		// Here too, not only in start: a job started once would otherwise be kept as long as no other one starts
		forgetOld();
		Running running = jobs.get(id);
		if (running == null) {
			return null;
		}
		// The state first: see Running
		String state = running.state;
		Map<String, Object> job = new LinkedHashMap<>();
		job.put("id", id);
		job.put("kind", running.kind);
		job.put("state", state);
		job.put("progress", running.progress);
		job.put("step", running.step);
		synchronized (running.messages) {
			job.put("messages", new ArrayList<>(running.messages));
		}
		job.put("result", running.result);
		job.put("error", running.error);
		return job;
	}

	/**
	 * Asks the job to stop: it does at its next check of JobContext.isCancelled(), as its thread is not interrupted
	 * (see JobContext). False when there is no such job.
	 */
	public boolean cancel(String id) {
		Running running = jobs.get(id);
		if (running == null) {
			return false;
		}
		running.cancelled = true;
		return true;
	}

	private void forgetOld() {
		long before = now.getAsLong() - TimeUnit.MINUTES.toMillis(FORGET_AFTER_MINUTES);
		// endedAt is written before the final state, so a job that has ended is never kept for want of it
		jobs.values().removeIf(job -> !RUNNING.equals(job.state) && job.endedAt < before);
	}

	@PreDestroy
	public void shutdown() {
		executor.shutdownNow();
	}
}
