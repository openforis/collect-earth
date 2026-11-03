package org.openforis.collect.earth.app.server.api;

import java.util.Map;

import org.openforis.collect.earth.app.service.jobs.JobService;
import org.openforis.collect.earth.app.service.jobs.JobService.Cancellation;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** The jobs the pages started (see JobService); each stage adds the POSTs that start them. */
@RestController
public class JobsController {

	private final JobService jobs;

	@Autowired
	public JobsController(JobService jobs) {
		this.jobs = jobs;
	}

	@GetMapping("/api/jobs/{id}")
	public ResponseEntity<Map<String, Object>> job(@PathVariable("id") String id) {
		Map<String, Object> job = jobs.get(id);
		return job == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(job);
	}

	/**
	 * Cancelling is a request the job honours at its next check (see JobContext), so the job may still be running when
	 * this answers: the page reads it until its state is CANCELLED. A job that is over already answers 409, so the page
	 * does not wait for a CANCELLED that will not come.
	 */
	@DeleteMapping("/api/jobs/{id}")
	public ResponseEntity<Void> cancel(@PathVariable("id") String id) {
		Cancellation cancellation = jobs.cancel(id);
		if (cancellation == Cancellation.UNKNOWN) {
			return ResponseEntity.notFound().build();
		} else if (cancellation == Cancellation.OVER) {
			throw new ApiException(HttpStatus.CONFLICT, "job.over", Messages.getString("JobsController.over"));
		}
		return ResponseEntity.ok().build();
	}
}
