package org.openforis.collect.earth.app.service.jobs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.openforis.concurrency.Progress;

/** The progress the long services report, as a job sees it. */
public class JobProgressTest {

	private final List<String> progress = new ArrayList<>();
	private final List<String> messages = new ArrayList<>();
	private boolean cancelled;
	private final JobProgress job = new JobProgress(new JobContext() {
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
	});

	@Test
	public void theCountsBecomeAPercentWithTheLastMessageAsTheStep() {
		job.updateProgress(1, 4);
		assertEquals("25 1/4", progress.get(0));
		job.setMessage("Exporting records");
		assertEquals("-1 Exporting records", progress.get(1));
		job.updateProgress(3, 4);
		assertEquals("75 Exporting records 3/4", progress.get(2));
		job.updateProgress(2, 9, "Generating CSV");
		assertEquals("22 Generating CSV 2/9", progress.get(3));
		job.updateProgress(40);
		assertEquals("40 Generating CSV 40%", progress.get(4));
		job.progressMade(new Progress(50, 100));
		assertEquals("50 Generating CSV 50/100", progress.get(5));
		// Collect's progress without a total says nothing about a percent
		job.progressMade(new Progress(3, 0));
		assertEquals(6, progress.size());
		job.updateProgress(3, 0);
		assertEquals("-1 Generating CSV 3/0", progress.get(6));
		// The messages go to the log too, so the page keeps what was done
		assertEquals(List.of("Exporting records"), messages);
	}

	@Test
	public void theCancellationIsTheJobs() {
		assertFalse(job.isUserCancelled());
		cancelled = true;
		assertTrue(job.isUserCancelled());
		// show and hide are the dialog's and do nothing here
		job.show();
		job.hide();
		assertTrue(progress.isEmpty());
	}
}
