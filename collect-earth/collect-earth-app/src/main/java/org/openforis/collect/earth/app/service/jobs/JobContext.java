package org.openforis.collect.earth.app.service.jobs;

/** What a running Job tells its page, and how it learns that the user cancelled it. */
public interface JobContext {
	/** @param percent 0-100, or -1 when it cannot be known */
	void progress(int percent, String step);

	void message(String line);

	/**
	 * True once the user asked the job to stop. Cancelling is cooperative: the thread of the job is not interrupted,
	 * except when Collect Earth shuts down (shutdownNow), as the services it calls do not all handle an interruption
	 * well, so a job that wants to be cancellable checks this between its steps and returns, or throws.
	 */
	boolean isCancelled();
}
