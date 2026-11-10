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

	@GetMapping("/api/cloud/localRecords")
	public Map<String, Object> localRecords() {
		return Collections.singletonMap("count", sender.localRecordCount());
	}

	@PostMapping("/api/jobs/sendToCloud")
	public Map<String, String> send() {
		try {
			return Collections.singletonMap("id", jobs.start(SEND_TO_CLOUD, sender.sendJob()));
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		} catch (IllegalStateException e) {
			throw new ApiException(HttpStatus.CONFLICT, "job.running", Messages.getString("DataPage.job.running"));
		}
	}
}
