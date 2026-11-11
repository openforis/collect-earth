package org.openforis.collect.earth.app.server.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.service.cloud.CloudRecordsSender;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.openforis.collect.earth.app.service.jobs.Job;
import org.openforis.collect.earth.app.service.jobs.JobService;
import org.springframework.test.web.servlet.MockMvc;

/** Data > Send this computer's records to the cloud project: the count offered, the job started, and why it is not. */
public class CloudSendControllerTest {

	private CloudRecordsSender sender;
	private JobService jobs;
	private MockMvc mvc;

	@BeforeEach
	public void wire() throws Exception {
		sender = mock(CloudRecordsSender.class);
		jobs = mock(JobService.class);
		mvc = TemplateWiring.mockMvc(new CloudSendController(sender, jobs), new ApiExceptionHandler());
	}

	@Test
	public void theRecordsOfThisComputerAreCounted() throws Exception {
		when(sender.localRecordCount()).thenReturn(42);
		mvc.perform(get("/api/cloud/localRecords")).andExpect(status().isOk()).andExpect(jsonPath("$.count").value(42));
	}

	@Test
	public void sendingIsAJobThePageFollows() throws Exception {
		Job job = mock(Job.class);
		when(sender.sendJob()).thenReturn(job);
		when(jobs.start(eq(CloudSendController.SEND_TO_CLOUD), any(Job.class))).thenReturn("job-7");
		mvc.perform(post("/api/jobs/sendToCloud")).andExpect(status().isOk()).andExpect(jsonPath("$.id").value("job-7"));
	}

	@Test
	public void aProjectThatCannotTakeThemSaysWhy() throws Exception {
		when(sender.sendJob()).thenThrow(new InvalidCloudRequestException("cloud.notJoined", "This project is not a cloud project"));
		mvc.perform(post("/api/jobs/sendToCloud")).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("cloud.notJoined"))
				.andExpect(jsonPath("$.message").value("This project is not a cloud project"));
	}

	@Test
	public void aSendingAlreadyRunningIsAConflict() throws Exception {
		when(sender.sendJob()).thenReturn(mock(Job.class));
		when(jobs.start(eq(CloudSendController.SEND_TO_CLOUD), any(Job.class))).thenThrow(new IllegalStateException("running"));
		mvc.perform(post("/api/jobs/sendToCloud")).andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("job.running"));
	}
}
