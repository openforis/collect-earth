package org.openforis.collect.earth.app.service.jobs;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.AnalysisProgress;
import org.openforis.concurrency.Progress;

/**
 * The progress of a job as the long services report it (AnalysisProgress): what the Swing InfiniteProgressMonitor
 * showed in its dialog goes to the job, which the page reads. The step shown is the last message set, with the
 * count or the percent after it; cancelling the job is what the dialog's Cancel was.
 */
public class JobProgress implements AnalysisProgress {

	private final JobContext context;
	private volatile String message = "";

	public JobProgress(JobContext context) {
		this.context = context;
	}

	@Override
	public void progressMade(Progress progress) {
		if (progress.getTotalItems() > 0) {
			updateProgress((int) progress.getProcessedItems(), (int) progress.getTotalItems());
		}
	}

	@Override
	public void updateProgress(int current, int total) {
		updateProgress(current, total, null);
	}

	@Override
	public void updateProgress(int current, int total, String step) {
		if (StringUtils.isNotBlank(step)) {
			message = step;
		}
		int percent = total > 0 ? (int) Math.min(100, Math.round(100.0 * current / total)) : -1;
		context.progress(percent, label(current + "/" + total));
	}

	@Override
	public void updateProgress(int percentage) {
		context.progress(Math.max(0, Math.min(100, percentage)), label(percentage + "%"));
	}

	@Override
	public void setMessage(String message) {
		this.message = message == null ? "" : message;
		context.progress(-1, this.message);
		if (!this.message.isEmpty()) {
			context.message(this.message);
		}
	}

	private String label(String figures) {
		return message.isEmpty() ? figures : message + " " + figures;
	}

	@Override
	public boolean isUserCancelled() {
		return context.isCancelled();
	}

	@Override
	public void show() {
		// A job has no dialog to show
	}

	@Override
	public void hide() {
		// nor to hide
	}
}
