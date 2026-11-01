package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.JoinPreview;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueStatus;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * The cloud flows of the Swing menu and window, for the pages: Join cloud project (CollectEarthMenu.joinCloudProject),
 * the login of CollectEarthWindow.promptCloudLogin, the status of CloudSyncStatusDialog.
 */
@Component
public class CloudService {

	/** A request the user can correct: its code names it, its message is in the UI language */
	public static class InvalidCloudRequestException extends Exception {
		private static final long serialVersionUID = 1L;
		private final String code;

		public InvalidCloudRequestException(String code, String message) {
			super(message);
			this.code = code;
		}

		public String getCode() {
			return code;
		}
	}

	/** What the page sends to join, once the preview was confirmed and the user typed their credentials */
	public static class JoinRequest {
		public String baseUrl;
		public String inviteToken;
		public String projectId;
		public String username;
		public String password;
		/** Register with the invitation rather than log in */
		public boolean register;
	}

	private static final String JOIN_MARKER = "/join/";

	private final Logger logger = LoggerFactory.getLogger(CloudService.class);
	private final CloudApiClient api;
	private final CloudSyncService sync;
	private final EarthProjectsService projects;
	private final LocalPropertiesService properties;

	@Autowired
	public CloudService(CloudApiClient api, CloudSyncService sync, EarthProjectsService projects, LocalPropertiesService properties) {
		this.api = api;
		this.sync = sync;
		this.projects = projects;
		this.properties = properties;
	}

	/** The server and the token of an invitation link (https://server/join/TOKEN, a query or a trailing slash dropped) */
	static String[] parseInvitation(String url) throws InvalidCloudRequestException {
		String link = StringUtils.trimToEmpty(url);
		int at = link.indexOf(JOIN_MARKER);
		if (at < 0) {
			throw new InvalidCloudRequestException("cloud.invalidUrl", Messages.getString("CloudJoin.invalidUrl"));
		}
		String baseUrl = link.substring(0, at);
		String token = link.substring(at + JOIN_MARKER.length());
		int query = token.indexOf('?');
		if (query >= 0) {
			token = token.substring(0, query);
		}
		while (token.endsWith("/")) {
			token = token.substring(0, token.length() - 1);
		}
		if (token.isEmpty()) {
			throw new InvalidCloudRequestException("cloud.invalidUrl", Messages.getString("CloudJoin.invalidUrl"));
		}
		return new String[] { baseUrl, token };
	}

	/** What the invitation is for, before the user confirms and logs in */
	public Map<String, Object> preview(String url) throws InvalidCloudRequestException, IOException {
		String[] invitation = parseInvitation(url);
		JoinPreview preview = api.getJoinPreview(invitation[0], invitation[1]);
		if (preview == null || !preview.isValid()) {
			throw new InvalidCloudRequestException("cloud.inviteInvalid", Messages.getString("CloudJoin.inviteInvalid"));
		}
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("baseUrl", invitation[0]);
		answer.put("inviteToken", invitation[1]);
		answer.put("projectId", preview.getProjectId());
		answer.put("projectName", preview.getProjectName());
		answer.put("role", preview.getRole());
		return answer;
	}

	/**
	 * Logs in or registers, downloads the project and loads it, and switches to cloud mode: the caller restarts. A
	 * failure leaves the configuration as it was.
	 */
	public void join(JoinRequest request) throws InvalidCloudRequestException, IOException {
		String username = StringUtils.trimToEmpty(request.username);
		String token = request.register ? authenticate(() -> api.register(request.baseUrl, username, request.password, request.inviteToken), request)
				: authenticate(() -> api.login(request.baseUrl, username, request.password), request);
		File cep = api.downloadCep(request.baseUrl, request.projectId, token);
		try {
			projects.loadCompressedProjectFile(cep);
		} finally {
			if (cep != null && !cep.delete()) {
				cep.deleteOnExit();
			}
		}
		properties.saveCloudSyncUrl(request.baseUrl);
		properties.saveCloudProjectId(request.projectId);
		properties.saveCloudSyncToken(token);
		properties.saveOperator(username);
		properties.setCloudSyncEnabled(true);
		properties.saveCollectDBDriver(CollectDBDriver.CLOUD);
	}

	/** The login of the prompt at start: the token saved, the operator is the user. @return the operator */
	public String login(String username, String password) throws InvalidCloudRequestException {
		JoinRequest credentials = new JoinRequest();
		credentials.username = username;
		credentials.password = password;
		String token = authenticate(() -> api.login(properties.getCloudSyncUrl(), username.trim(), password), credentials);
		properties.saveCloudSyncToken(token);
		properties.saveOperator(username.trim());
		return username.trim();
	}

	private interface Authentication {
		String call() throws IOException;
	}

	/** The checks of CloudLoginDialog: the fields filled, the server's refusal in its words, a token answered */
	private String authenticate(Authentication authentication, JoinRequest credentials) throws InvalidCloudRequestException {
		if (StringUtils.isBlank(credentials.username) || StringUtils.isEmpty(credentials.password)) {
			throw new InvalidCloudRequestException("cloud.emptyFields", Messages.getString("CloudLoginDialog.emptyFields"));
		}
		String token;
		try {
			token = authentication.call();
		} catch (IOException | RuntimeException e) {
			logger.warn("The cloud login failed: {}", e.getMessage());
			throw new InvalidCloudRequestException("cloud.login", StringUtils.defaultIfBlank(e.getMessage(), Messages.getString("CloudLoginDialog.failed")));
		}
		if (StringUtils.isBlank(token)) {
			throw new InvalidCloudRequestException("cloud.noToken", Messages.getString("CloudLoginDialog.noToken"));
		}
		return token;
	}

	/** The status of the sync, as CloudSyncStatusDialog showed it */
	public Map<String, Object> status() {
		Map<String, Object> answer = new LinkedHashMap<>();
		boolean enabled = properties.isCloudSyncEnabled();
		answer.put("enabled", enabled);
		answer.put("project", StringUtils.trimToNull(properties.getCloudProjectId()));
		if (enabled) {
			QueueStatus status = sync.getStatusSnapshot();
			answer.put("pending", status.getPending());
			answer.put("failed", status.getFailed());
			answer.put("synced", status.getSynced());
			Date lastSync = status.getLastSyncedOn();
			answer.put("lastSync", lastSync == null ? null : lastSync.getTime());
			answer.put("lastError", StringUtils.trimToNull(status.getLastError()));
		}
		return answer;
	}

	public void syncNow() {
		sync.syncNowAsync();
	}
}
