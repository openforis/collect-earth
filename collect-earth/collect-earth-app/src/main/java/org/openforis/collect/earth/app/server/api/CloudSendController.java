package org.openforis.collect.earth.app.server.api;

import java.util.Collections;
import java.util.Map;

import org.openforis.collect.earth.app.service.cloud.CloudRecordsSender;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.openforis.collect.earth.app.service.jobs.JobService;
import org.openforis.collect.earth.app.view.Messages;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Data > Send this computer's records to the cloud project (CloudRecordsSender). */
@RestController
public class CloudSendController {

	static final String SEND_TO_CLOUD = "sendToCloud";

	private final CloudRecordsSender sender;
	private final JobService jobs;

	@Autowired
	public CloudSendController(CloudRecordsSender sender, JobService jobs) {
		this.sender = sender;
		this.jobs = jobs;
	}

	/** {count, mine, others, names}: the records of the project here, the person's and those under other names */
	@GetMapping("/api/cloud/localRecords")
	public Map<String, Object> localRecords() throws java.io.IOException {
		return sender.localRecords();
	}

	/** The person's records; with {@code all=true} those under other names too (they are then the person's in the cloud) */
	@PostMapping("/api/jobs/sendToCloud")
	public Map<String, String> send(@org.springframework.web.bind.annotation.RequestParam(value = "all", defaultValue = "false") boolean all) {
		try {
			return Collections.singletonMap("id", jobs.start(SEND_TO_CLOUD, sender.sendJob(all)));
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		} catch (IllegalStateException e) {
			throw new ApiException(HttpStatus.CONFLICT, "job.running", Messages.getString("DataPage.job.running"));
		}
	}
}
