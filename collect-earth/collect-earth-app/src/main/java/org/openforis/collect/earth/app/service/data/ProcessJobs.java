package org.openforis.collect.earth.app.service.data;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.apache.commons.lang3.ArrayUtils;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.jobs.JobContext;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.io.ReferenceDataImportStatus;
import org.openforis.collect.io.metadata.parsing.ParsingError;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.manager.process.ProcessStatus;

/**
 * Runs a process of Collect (an export, the CSV import) inside a job: what the Swing ProcessMonitorDialog did with a
 * ProgressMonitor. The process runs on the job's thread; a watcher copies its status into the job every POLL_MILLIS
 * (the percent, and "processed/total" as the dialog's note) and cancels it when the job is cancelled. A process that
 * ends in error fails the job with the status message, and the parsing errors of a CSV import go to the job's log,
 * formatted as the dialog formatted them.
 */
public final class ProcessJobs {

	static final long POLL_MILLIS = 250;
	/** How many parsing errors are logged: the dialog showed 10, the page has room for more */
	static final int MAX_ERRORS_LOGGED = 50;

	/** The process ended in error: the message of its status, and the parsing errors when it has them. */
	public static class ProcessFailedException extends Exception {
		private static final long serialVersionUID = 1L;
		private final List<String> details;

		public ProcessFailedException(String message, List<String> details) {
			super(message);
			this.details = details;
		}

		public List<String> getDetails() {
			return details;
		}
	}

	private ProcessJobs() {
	}

	/**
	 * @param step the label of the progress, before "processed/total" (ExportDialogProcessMonitor.4 for an export)
	 * @return the status the process ended with: complete, or cancelled when the job was
	 * @throws ProcessFailedException when the status says error
	 * @throws Exception              what the process threw
	 */
	public static <S extends ProcessStatus> S run(AbstractProcess<?, S> process, JobContext context, String step) throws Exception {
		Watcher watcher = new Watcher(process, context, step);
		watcher.start();
		try {
			process.call();
		} finally {
			watcher.stopWatching();
		}
		S status = process.getStatus();
		report(status, context, step);
		if (status != null && status.isError()) {
			List<String> details = parsingErrors(status);
			for (String detail : details) {
				context.message(detail);
			}
			throw new ProcessFailedException(StringUtils.defaultIfBlank(status.getErrorMessage(), Messages.getString("DataPage.processFailed")),
					details);
		}
		return status;
	}

	private static void report(ProcessStatus status, JobContext context, String step) {
		if (status == null) {
			return;
		}
		int percent = status.getTotal() > 0 ? status.getProgressPercent() : -1;
		context.progress(percent, step + " " + status.getProcessed() + "/" + status.getTotal());
	}

	/** The parsing errors of a CSV import, as ProcessMonitorDialog listed them: the first MAX_ERRORS_LOGGED, then how many there are. */
	static List<String> parsingErrors(ProcessStatus status) {
		if (!(status instanceof ReferenceDataImportStatus)) {
			return Collections.emptyList();
		}
		List<? extends ParsingError> errors = ((ReferenceDataImportStatus<?>) status).getErrors();
		List<String> lines = new ArrayList<>();
		for (ParsingError error : errors) {
			if (lines.size() >= MAX_ERRORS_LOGGED) {
				lines.add(Messages.getString("ProcessMonitorDialog.moreWarnings") + errors.size());
				break;
			}
			lines.add(Messages.getString("ProcessMonitorDialog.1") + " " + error.getRow() + " - " + error.getMessage() + ", " + error.getErrorType()
					+ Messages.getString("ProcessMonitorDialog.4") + " " + ArrayUtils.toString(error.getColumns())
					+ Messages.getString("ProcessMonitorDialog.5") + " " + ArrayUtils.toString(error.getMessageArgs()));
		}
		return lines;
	}

	/** Copies the status into the job while the process runs, and cancels the process when the job is cancelled. */
	private static final class Watcher extends Thread {
		private final AbstractProcess<?, ?> process;
		private final JobContext context;
		private final String step;
		private volatile boolean watching = true;
		private boolean cancelled;

		Watcher(AbstractProcess<?, ?> process, JobContext context, String step) {
			super("Watching a process of Collect");
			setDaemon(true);
			this.process = process;
			this.context = context;
			this.step = step;
		}

		@Override
		public void run() {
			while (watching) {
				report(process.getStatus(), context, step);
				if (!cancelled && context.isCancelled()) {
					cancelled = true;
					process.cancel();
				}
				try {
					Thread.sleep(POLL_MILLIS);
				} catch (InterruptedException e) {
					return;
				}
			}
		}

		void stopWatching() {
			watching = false;
			interrupt();
		}
	}
}
