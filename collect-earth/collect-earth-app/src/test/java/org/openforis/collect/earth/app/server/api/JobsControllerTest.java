package org.openforis.collect.earth.app.server.api;

import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.jobs.JobService;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.test.web.servlet.MockMvc;

/** The jobs the pages follow and cancel, answered as the server's own wiring does (see TemplateWiring). */
public class JobsControllerTest {

	private final JobService jobs = new JobService();
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		mvc = TemplateWiring.mockMvc(new JobsController(jobs), new ApiExceptionHandler());
	}

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
	public void aJobIsRead() throws Exception {
		String id = jobs.start("export", ctx -> "done");
		waitUntilOver(id);
		mvc.perform(get("/api/jobs/" + id)).andExpect(status().isOk()).andExpect(jsonPath("$.state").value("DONE"))
				.andExpect(jsonPath("$.result").value("done"));
	}

	@Test
	public void anUnknownJobIsNotFound() throws Exception {
		mvc.perform(get("/api/jobs/nope")).andExpect(status().isNotFound());
		mvc.perform(delete("/api/jobs/nope")).andExpect(status().isNotFound());
	}

	@Test
	public void aRunningJobIsCancelled() throws Exception {
		CountDownLatch started = new CountDownLatch(1);
		String id = jobs.start("export", ctx -> {
			started.countDown();
			while (!ctx.isCancelled()) {
				Thread.sleep(10);
			}
			return null;
		});
		assertTrue(started.await(2, TimeUnit.SECONDS));
		mvc.perform(delete("/api/jobs/" + id)).andExpect(status().isOk());
		assertEquals("CANCELLED", waitUntilOver(id).get("state"));
	}

	@Test
	public void aJobThatIsOverCannotBeCancelled() throws Exception {
		String id = jobs.start("export", ctx -> "done");
		waitUntilOver(id);
		mvc.perform(delete("/api/jobs/" + id)).andExpect(status().isConflict())
				.andExpect(jsonPath("$.error").value("job.over"))
				.andExpect(jsonPath("$.message").value(Messages.getString("JobsController.over")))
				// Messages answers !key! for a key no bundle has
				.andExpect(jsonPath("$.message").value(not(startsWith("!"))));
	}
}
