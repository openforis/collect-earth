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
import org.springframework.web.bind.annotation.RequestParam;
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
		/** Two-step sign-in's code, once the server asked for it */
		public String code;
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

	/** The cloud projects of the user signed in here (Project > Switch project) */
	@GetMapping("/api/cloud/projects")
	public Map<String, Object> projects() {
		try {
			return Collections.singletonMap("projects", cloud.myProjects());
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	public static class OpenRequest {
		public String projectId;
		/** The server it is on; the first signed in to when not given */
		public String server;
	}

	/** One of them opened: the restart follows the answer, as after a join */
	@PostMapping("/api/cloud/projects/open")
	public Map<String, Object> open(@RequestBody OpenRequest request) throws IOException {
		try {
			cloud.open(request.projectId, request.server);
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
		restart.run();
		return Collections.singletonMap("restart", true);
	}

	@PostMapping("/api/cloud/login")
	public Map<String, Object> login(@RequestBody LoginRequest request) {
		try {
			String operator = request.code == null || request.code.trim().isEmpty() ? cloud.login(request.username, request.password)
					: cloud.login(request.username, request.password, request.code);
			return Collections.singletonMap("operator", operator);
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	public static class TokenRequest {
		public String url;
		public String username;
		public String password;
		/** Two-step sign-in's code, once the server asked for it */
		public String code;
	}

	/** The Log in button of the settings: the token of the server typed there, for its field; nothing is saved */
	@PostMapping("/api/cloud/token")
	public Map<String, Object> token(@RequestBody TokenRequest request) {
		try {
			String token = request.code == null || request.code.trim().isEmpty() ? cloud.token(request.url, request.username, request.password)
					: cloud.token(request.url, request.username, request.password, request.code);
			return Collections.singletonMap("token", token);
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	@GetMapping("/api/cloud/status")
	public Map<String, Object> status() {
		return cloud.status();
	}

	/** The open project's cloud state, its sync's and the servers signed in to (CloudService.state) */
	@GetMapping("/api/cloud/state")
	public Map<String, Object> state() {
		return cloud.state();
	}

	public static class SignOutRequest {
		public String server;
	}

	/** Signs out of a server: its projects' sync pauses until the sign-in. Answers the new state */
	@PostMapping("/api/cloud/signOut")
	public Map<String, Object> signOut(@RequestBody SignOutRequest request) {
		try {
			return cloud.signOut(request == null ? null : request.server);
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	/** Where a record of the open project is (local, pending, sent, failed), by its key as the form has it */
	@GetMapping("/api/cloud/recordSync")
	public Map<String, Object> recordSync(@RequestParam("key") String key) {
		return cloud.recordSync(key);
	}

	@PostMapping("/api/cloud/syncNow")
	public void syncNow() {
		cloud.syncNow();
	}

	/** The training feedback of a plot just submitted (a learning set's), for the plot form */
	@GetMapping("/api/cloud/training-feedback")
	public Map<String, Object> trainingFeedback(@RequestParam("plot") String plot) {
		return cloud.trainingFeedback(plot);
	}

	/** A plot's answers in the earlier periods of a repeat survey, for the header of its form */
	@GetMapping("/api/cloud/plot-periods")
	public Map<String, Object> plotPeriods(@RequestParam("plot") String plot) {
		return cloud.plotPeriods(plot);
	}

	/** The plot files assigned to the operator, for the Project section of the settings in cloud mode */
	@GetMapping("/api/cloud/assignments")
	public Map<String, Object> assignments() {
		try {
			return Collections.singletonMap("assignments", cloud.assignments());
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}

	public static class AssignmentRequest {
		public String id;
	}

	/** Downloads one of them: the page then makes it the plots file, which Apply saves */
	@PostMapping("/api/cloud/assignments/download")
	public Map<String, Object> download(@RequestBody AssignmentRequest request) {
		try {
			return Collections.singletonMap("path", cloud.downloadAssignment(request.id).getAbsolutePath());
		} catch (InvalidCloudRequestException e) {
			throw new ApiException(e.getCode(), e.getMessage());
		}
	}
}
