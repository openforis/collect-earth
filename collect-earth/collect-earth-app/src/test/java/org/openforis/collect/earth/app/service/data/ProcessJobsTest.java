package org.openforis.collect.earth.app.service.data;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.data.ProcessJobs.ProcessFailedException;
import org.openforis.collect.earth.app.service.jobs.JobContext;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.io.ReferenceDataImportStatus;
import org.openforis.collect.io.metadata.parsing.ParsingError;
import org.openforis.collect.io.metadata.parsing.ParsingError.ErrorType;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.manager.process.ProcessStatus;

/** A process of Collect run as a job, with a process whose status the test moves. */
public class ProcessJobsTest {

	/** What the job saw */
	static final class RecordingContext implements JobContext {
		final List<String> progress = new CopyOnWriteArrayList<>();
		final List<String> messages = new CopyOnWriteArrayList<>();
		volatile boolean cancelled;

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

	/** A process that processes `total` items, one every 60 ms, unless cancelled or told to fail. */
	static final class SlowProcess extends AbstractProcess<Void, ProcessStatus> {
		private final int total;
		private final String failAt;

		SlowProcess(int total, String failAt) {
			this.total = total;
			this.failAt = failAt;
			initStatus();
		}

		@Override
		protected void initStatus() {
			status = new ProcessStatus();
		}

		@Override
		public ProcessStatus getStatus() {
			return status;
		}

		@Override
		public void cancel() {
			status.cancel();
		}

		@Override
		public Void call() throws Exception {
			status.start();
			status.setTotal(total);
			for (int i = 0; i < total && !status.isCancelled(); i++) {
				Thread.sleep(60);
				status.incrementProcessed();
				if (failAt != null && status.getProcessed() == 2) {
					status.setErrorMessage(failAt);
					status.error();
					return null;
				}
			}
			if (!status.isCancelled()) {
				status.complete();
			}
			return null;
		}

		@Override
		public void startProcessing() {
		}
	}

	@Test
	public void theProgressOfTheProcessIsTheJobs() throws Exception {
		RecordingContext context = new RecordingContext();
		ProcessStatus status = ProcessJobs.run(new SlowProcess(4, null), context, "Exported records :");
		assertTrue(status.isComplete());
		// The last report is the end, whatever the watcher saw before
		assertEquals("100 Exported records : 4/4", context.progress.get(context.progress.size() - 1));
		assertTrue(context.messages.isEmpty());
	}

	@Test
	public void aCancelledJobCancelsTheProcess() throws Exception {
		RecordingContext context = new RecordingContext();
		SlowProcess process = new SlowProcess(50, null);
		new Thread(() -> {
			try {
				Thread.sleep(300);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
			context.cancelled = true;
		}).start();
		long started = System.currentTimeMillis();
		ProcessStatus status = ProcessJobs.run(process, context, "Exported records :");
		assertTrue(status.isCancelled());
		assertFalse(status.isComplete());
		// 50 items would take 3 s: it stopped at the cancellation, within a poll of it
		assertTrue(System.currentTimeMillis() - started < 2000);
	}

	@Test
	public void aProcessThatEndsInErrorFailsTheJobWithItsMessage() {
		RecordingContext context = new RecordingContext();
		ProcessFailedException failure = assertThrows(ProcessFailedException.class,
				() -> ProcessJobs.run(new SlowProcess(4, "The database is locked"), context, "Exported records :"));
		assertEquals("The database is locked", failure.getMessage());
		assertTrue(failure.getDetails().isEmpty());
	}

	@Test
	public void theParsingErrorsOfACsvImportGoToTheLog() {
		ReferenceDataImportStatus<ParsingError> status = new ReferenceDataImportStatus<>();
		status.addParsingError(new ParsingError(ErrorType.INVALID_VALUE, 3, new String[] { "land_use" }, "not a code"));
		status.addParsingError(new ParsingError(ErrorType.EMPTY, 7, "id", "empty"));
		List<String> lines = ProcessJobs.parsingErrors(status);
		assertEquals(2, lines.size());
		assertTrue(lines.get(0).startsWith(Messages.getString("ProcessMonitorDialog.1") + " 3 - not a code, INVALID_VALUE"));
		assertTrue(lines.get(0).contains("land_use"));
		assertTrue(lines.get(1).contains(" 7 - "));
		// A status of another kind has none
		assertTrue(ProcessJobs.parsingErrors(new ProcessStatus()).isEmpty());
	}

	@Test
	public void onlyTheFirstParsingErrorsAreLogged() {
		ReferenceDataImportStatus<ParsingError> status = new ReferenceDataImportStatus<>();
		for (int row = 1; row <= ProcessJobs.MAX_ERRORS_LOGGED + 5; row++) {
			status.addParsingError(new ParsingError(ErrorType.INVALID_VALUE, row, "id", "wrong"));
		}
		List<String> lines = new ArrayList<>(ProcessJobs.parsingErrors(status));
		assertEquals(ProcessJobs.MAX_ERRORS_LOGGED + 1, lines.size());
		assertEquals(Messages.getString("ProcessMonitorDialog.moreWarnings") + (ProcessJobs.MAX_ERRORS_LOGGED + 5), lines.get(lines.size() - 1));
	}
}
