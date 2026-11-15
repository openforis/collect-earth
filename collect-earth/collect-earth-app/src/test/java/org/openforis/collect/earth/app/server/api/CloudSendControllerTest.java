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
	public void theRecordsOfThisComputerAreCountedTheirsApart() throws Exception {
		java.util.Map<String, Object> local = new java.util.LinkedHashMap<>();
		local.put("count", 42);
		local.put("mine", 40);
		local.put("others", 2);
		local.put("names", java.util.Arrays.asList("Juan"));
		when(sender.localRecords()).thenReturn(local);
		mvc.perform(get("/api/cloud/localRecords")).andExpect(status().isOk()).andExpect(jsonPath("$.count").value(42))
				.andExpect(jsonPath("$.mine").value(40)).andExpect(jsonPath("$.others").value(2)).andExpect(jsonPath("$.names[0]").value("Juan"));
	}

	@Test
	public void sendingIsAJobThePageFollowsTheirOwnUnlessAllAreAskedFor() throws Exception {
		Job mine = mock(Job.class);
		Job all = mock(Job.class);
		when(sender.sendJob(false)).thenReturn(mine);
		when(sender.sendJob(true)).thenReturn(all);
		when(jobs.start(CloudSendController.SEND_TO_CLOUD, mine)).thenReturn("job-7");
		when(jobs.start(CloudSendController.SEND_TO_CLOUD, all)).thenReturn("job-8");
		mvc.perform(post("/api/jobs/sendToCloud")).andExpect(status().isOk()).andExpect(jsonPath("$.id").value("job-7"));
		mvc.perform(post("/api/jobs/sendToCloud?all=true")).andExpect(status().isOk()).andExpect(jsonPath("$.id").value("job-8"));
	}

	@Test
	public void aProjectThatCannotTakeThemSaysWhy() throws Exception {
		when(sender.sendJob(false)).thenThrow(new InvalidCloudRequestException("cloud.notJoined", "This project is not a cloud project"));
		mvc.perform(post("/api/jobs/sendToCloud")).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("cloud.notJoined"))
				.andExpect(jsonPath("$.message").value("This project is not a cloud project"));
	}

	@Test
	public void aSendingAlreadyRunningIsAConflict() throws Exception {
		when(sender.sendJob(false)).thenReturn(mock(Job.class));
		when(jobs.start(eq(CloudSendController.SEND_TO_CLOUD), any(Job.class))).thenThrow(new IllegalStateException("running"));
		mvc.perform(post("/api/jobs/sendToCloud")).andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("job.running"));
	}
}
