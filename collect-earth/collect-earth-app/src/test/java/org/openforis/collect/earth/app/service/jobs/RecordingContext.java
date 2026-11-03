package org.openforis.collect.earth.app.service.jobs;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** A JobContext for the tests of the jobs: what the job reported, and a cancellation the test raises. */
public final class RecordingContext implements JobContext {
	public final List<String> progress = new CopyOnWriteArrayList<>();
	public final List<String> messages = new CopyOnWriteArrayList<>();
	public volatile boolean cancelled;

	@Override
	public void progress(int percent, String step) {
		progress.add(percent + " " + step);
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
