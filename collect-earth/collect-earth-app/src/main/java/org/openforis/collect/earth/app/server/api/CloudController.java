package org.openforis.collect.earth.app.server.api;

import java.io.IOException;
import java.util.Collections;
import java.util.Map;

import org.openforis.collect.earth.app.service.RestartService;
import org.openforis.collect.earth.app.service.cloud.CloudService;
import org.openforis.collect.earth.app.service.cloud.CloudService.InvalidCloudRequestException;
import org.openforis.collect.earth.app.service.cloud.CloudService.JoinRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Join cloud project, the cloud login and the sync status of the Project menu (CloudService). */
@RestController
public class CloudController {

	public static class UrlRequest {
		public String url;
	}

	public static class LoginRequest {
		public String username;
		public String password;
	}

	private final CloudService cloud;
	private final Runnable restart;

	@Autowired
	public CloudController(CloudService cloud, RestartService restart) {
		this(cloud, (Runnable) restart);
	}

	CloudController(CloudService cloud, Runnable restart) {
		this.cloud = cloud;
		this.restart = restart;
	}

	@PostMapping("/api/cloud/preview")
	public Map<String, Object> preview(@RequestBody UrlRequest request) throws IOException {
		try {
			return cloud.preview(request.url);
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	/** Joined: the restart follows the answer, as after a project loaded */
	@PostMapping("/api/cloud/join")
	public Map<String, Object> join(@RequestBody JoinRequest request) throws IOException {
		try {
			cloud.join(request);
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
		restart.run();
		return Collections.singletonMap("restart", true);
	}

	@PostMapping("/api/cloud/login")
	public Map<String, Object> login(@RequestBody LoginRequest request) {
		try {
			return Collections.singletonMap("operator", cloud.login(request.username, request.password));
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	@GetMapping("/api/cloud/status")
	public Map<String, Object> status() {
		return cloud.status();
	}

	@PostMapping("/api/cloud/syncNow")
	public void syncNow() {
		cloud.syncNow();
	}
}
