package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.logging.GAlogger;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.AssignmentInfo;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.CloudApiException;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.JoinPreview;
import org.openforis.collect.earth.app.service.cloud.CloudSyncQueueDao.QueueStatus;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.model.CollectSurvey;
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
		/** Two-step sign-in: the code of the authenticator app (or a recovery code), once the server asked for it */
		public String code;
	}

	private static final String JOIN_MARKER = "/join/";

	private final Logger logger = LoggerFactory.getLogger(CloudService.class);
	private final CloudApiClient api;
	private final CloudSyncService sync;
	private final EarthProjectsService projects;
	private final LocalPropertiesService properties;

	/** To start a learning set's new attempt afresh (deleting earlier records); absent in some tests. */
	private EarthSurveyService surveyService;

	@Autowired(required = false)
	public void setSurveyService(EarthSurveyService surveyService) {
		this.surveyService = surveyService;
	}

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

	/**
	 * The shortest password an account registered from an invitation may have: the cloud server's rule
	 * (collect-earth-cloud, src/accountRules.ts MIN_PASSWORD_LENGTH), checked here first to say it plainly.
	 */
	static final int MIN_PASSWORD_LENGTH = 8;

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
		// Said here, in the user's language, before the server is asked: it refuses the same (weak_password)
		if (request.register && StringUtils.isNotEmpty(request.password) && StringUtils.isNotBlank(username)
				&& request.password.length() < MIN_PASSWORD_LENGTH) {
			throw new InvalidCloudRequestException("cloud.weakPassword", Messages.getString("CloudLoginDialog.passwordTooShort"));
		}
		// Log in with the invitation: someone who has an account (another project's) joins this one with it
		String token = request.register ? authenticate(() -> api.register(request.baseUrl, username, request.password, request.inviteToken), request)
				: authenticate(() -> login(request.baseUrl, username, request.password, request.code, request.inviteToken), request);
		useProject(request.baseUrl, request.projectId, token, username);
		// The next start offers to send the records this computer already has (CloudRecordsSender)
		properties.setValue(EarthProperty.CLOUD_OFFER_LOCAL_RECORDS, Boolean.TRUE.toString());
	}

	/**
	 * Downloads the project and loads it, binds its folder to the cloud project (the other projects keep theirs), keeps
	 * the server's sign-in, and switches to cloud mode for it: the caller restarts.
	 */
	private void useProject(String baseUrl, String projectId, String token, String username) throws InvalidCloudRequestException, IOException {
		File cep = api.downloadCep(baseUrl, projectId, token);
		try {
			refuseToReplaceUnsent(projects.projectFolderFor(cep), projectId);
			projects.loadCompressedProjectFile(cep);
		} finally {
			if (cep != null && !cep.delete()) {
				cep.deleteOnExit();
			}
		}
		String server = LocalPropertiesService.normalizeServer(baseUrl);
		CloudBinding binding = new CloudBinding(properties.getProjectFolder(), server, projectId, null, username);
		describe(api, binding, token);
		properties.saveCloudBinding(binding);
		properties.saveCloudToken(server, username, token);
		if (StringUtils.isNotBlank(username)) {
			properties.saveOperator(username);
		}
		properties.setCloudSyncEnabled(true);
		properties.saveCollectDBDriver(CollectDBDriver.CLOUD);
	}

	/**
	 * The cloud projects of the user on every server signed in to here (the tokens kept since the joins), each with its
	 * server, the one open marked, and those already on this computer (a project folder bound to them). None when
	 * nobody is signed in; refused only when no server could be asked.
	 */
	public List<Map<String, Object>> myProjects() throws InvalidCloudRequestException {
		Map<String, String> accounts = properties.getCloudAccounts();
		String openServer = properties.isCloudSyncEnabled() ? LocalPropertiesService.normalizeServer(properties.getCloudSyncUrl()) : null;
		String openProject = properties.isCloudSyncEnabled() ? properties.getCloudProjectId() : null;
		List<CloudBinding> bindings = properties.getCloudBindings();
		List<Map<String, Object>> list = new ArrayList<>();
		int failed = 0;
		for (String server : accounts.keySet()) {
			List<JoinPreview> found;
			try {
				found = api.listProjects(server, properties.getCloudToken(server));
			} catch (IOException e) {
				logger.warn("The cloud projects of {} could not be listed: {}", server, e.getMessage());
				failed++;
				continue;
			}
			for (JoinPreview project : found) {
				Map<String, Object> entry = new LinkedHashMap<>();
				entry.put("projectId", project.getProjectId());
				entry.put("projectName", project.getProjectName());
				entry.put("role", project.getRole());
				entry.put("active", server.equals(openServer) && StringUtils.equals(project.getProjectId(), openProject));
				entry.put("server", server);
				entry.put("serverName", hostOf(server));
				entry.put("onThisComputer", bindings.stream().anyMatch(b -> server.equals(b.server) && StringUtils.equals(project.getProjectId(), b.projectId)));
				list.add(entry);
			}
		}
		if (failed > 0 && failed == accounts.size()) {
			throw new InvalidCloudRequestException("cloud.projects", Messages.getString("CloudProjects.failed"));
		}
		return list;
	}

	/**
	 * Opens one of {@link #myProjects()} with the sign-in kept for its server (the first signed in to when none is
	 * given), as a join does with no invitation or login: the caller restarts.
	 */
	public void open(String projectId, String server) throws InvalidCloudRequestException, IOException {
		Map<String, String> accounts = properties.getCloudAccounts();
		String url = StringUtils.isNotBlank(server) ? LocalPropertiesService.normalizeServer(server)
				: accounts.isEmpty() ? null : accounts.keySet().iterator().next();
		String token = url == null ? null : properties.getCloudToken(url);
		// An id, nothing else, as it goes into the address of the download
		if (StringUtils.isBlank(token) || projectId == null || !projectId.matches("[A-Za-z0-9_-]+")) {
			throw new InvalidCloudRequestException("cloud.projects", Messages.getString("CloudProjects.failed"));
		}
		useProject(url, projectId, token, accounts.get(url));
	}

	/**
	 * Joining unzips the project over the folder of its survey: when that folder is another cloud project's with records
	 * not sent yet, it is refused, as they would be sent nowhere (the queue keeps them for their own cloud project).
	 */
	private void refuseToReplaceUnsent(File folder, String projectId) throws InvalidCloudRequestException {
		CloudBinding bound = properties.getCloudBinding(folder);
		if (bound == null || StringUtils.equals(bound.projectId, projectId)) {
			return;
		}
		int unsent = sync.unsentCount(bound.projectId);
		if (unsent > 0) {
			String name = StringUtils.defaultIfBlank(bound.projectName, folder.getName());
			throw new InvalidCloudRequestException("cloud.unsentRecords", MessageFormat.format(Messages.getString("CloudJoin.unsentRecords"), unsent, name));
		}
	}

	/**
	 * Asks the server for a binding's project name (the survey's is shown without it), the account's role in the project
	 * and whether it is the server's administrator. @return false when the server could not be asked
	 */
	static boolean describe(CloudApiClient api, CloudBinding binding, String token) {
		try {
			JoinPreview project = api.getProject(new CloudApiClient.Destination(binding.server, binding.projectId, token));
			if (project != null) {
				binding.projectName = StringUtils.defaultIfBlank(project.getProjectName(), binding.projectName);
				binding.role = StringUtils.trimToNull(project.getRole());
			}
		} catch (IOException | RuntimeException e) {
			LoggerFactory.getLogger(CloudService.class).warn("Could not ask for the cloud project {}: {}", binding.projectId, e.getMessage());
			return false;
		}
		try {
			binding.serverAdmin = api.isServerAdmin(binding.server, token);
		} catch (IOException | RuntimeException e) {
			LoggerFactory.getLogger(CloudService.class).debug("Could not ask whether the account is the server's administrator: {}", e.getMessage());
		}
		return true;
	}

	/** The login of the prompt at start: the token of the server of the project open saved, the operator is the user. @return the operator */
	public String login(String username, String password) throws InvalidCloudRequestException {
		return login(username, password, null);
	}

	/** {@link #login(String, String)} with the code of two-step sign-in, once the server asked for it. */
	public String login(String username, String password, String code) throws InvalidCloudRequestException {
		JoinRequest credentials = new JoinRequest();
		credentials.username = username;
		credentials.password = password;
		String server = properties.getCloudSyncUrl();
		String token = authenticate(() -> login(server, username.trim(), password, code, null), credentials);
		// One account per server: every project on it is collected with it from now on
		properties.saveCloudToken(server, username.trim(), token);
		properties.saveOperator(username.trim());
		return username.trim();
	}

	/**
	 * The open project's cloud state, its sync's, and the servers signed in to (the contract of GET /api/cloud/state):
	 * {@code project} (mode local or cloud, name, server, serverName, cloudProjectId, cloudProjectName, account,
	 * signedIn, role, serverAdmin), {@code sync} (null in a local project; pending, failed, lastSyncedOn, lastError, online, needsSignIn) and
	 * {@code accounts} (server, serverName, username).
	 */
	public Map<String, Object> state() {
		boolean cloud = properties.isCloudSyncEnabled();
		CloudBinding binding = cloud ? properties.getCloudBinding() : null;
		String server = cloud ? StringUtils.trimToNull(LocalPropertiesService.normalizeServer(properties.getCloudSyncUrl())) : null;
		boolean signedIn = cloud && StringUtils.isNotBlank(properties.getCloudSyncToken());
		String name = surveyName();
		Map<String, Object> project = new LinkedHashMap<>();
		project.put("mode", cloud ? "cloud" : "local");
		project.put("name", name);
		project.put("server", server);
		project.put("serverName", hostOf(server));
		project.put("cloudProjectId", cloud ? StringUtils.trimToNull(properties.getCloudProjectId()) : null);
		project.put("cloudProjectName", !cloud ? null : binding != null && StringUtils.isNotBlank(binding.projectName) ? binding.projectName : name);
		project.put("account", !cloud ? null
				: binding != null && StringUtils.isNotBlank(binding.username) ? binding.username : StringUtils.trimToNull(properties.getOperator()));
		project.put("signedIn", signedIn);
		// Collector or coordinator: the account's role in the cloud project, as the server last said (CloudSyncService)
		project.put("role", binding == null ? null : binding.role);
		project.put("serverAdmin", binding == null ? null : binding.serverAdmin);
		Map<String, Object> syncState = null;
		if (cloud) {
			QueueStatus status = sync.getStatusSnapshot();
			syncState = new LinkedHashMap<>();
			syncState.put("pending", status.getPending());
			syncState.put("failed", status.getFailed());
			syncState.put("lastSyncedOn", status.getLastSyncedOn() == null ? null : status.getLastSyncedOn().toInstant().toString());
			syncState.put("lastError", StringUtils.trimToNull(status.getLastError()));
			syncState.put("online", sync.isOnline());
			syncState.put("needsSignIn", !signedIn);
		}
		List<Map<String, Object>> accounts = new ArrayList<>();
		properties.getCloudAccounts().forEach((url, username) -> {
			Map<String, Object> account = new LinkedHashMap<>();
			account.put("server", url);
			account.put("serverName", hostOf(url));
			account.put("username", username);
			accounts.add(account);
		});
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("project", project);
		answer.put("sync", syncState);
		answer.put("accounts", accounts);
		return answer;
	}

	/**
	 * Signs out of a server: its token is forgotten (here and in the system's keyring), the sync of its projects pauses
	 * while their records keep queueing, and the pages ask for the sign-in again. @return the new state
	 */
	public Map<String, Object> signOut(String server) throws InvalidCloudRequestException {
		if (StringUtils.isBlank(server)) {
			throw new InvalidCloudRequestException("cloud.urlRequired", Messages.getString("DatabaseServerPanel.cloudUrlRequired"));
		}
		properties.saveCloudToken(server, null, "");
		return state();
	}

	/** Where a record of the open project is: local (a local project, or not queued), pending, sent or failed. */
	public Map<String, Object> recordSync(String recordKey) {
		String state = properties.isCloudSyncEnabled() && StringUtils.isNotBlank(recordKey) ? sync.recordState(recordKey.trim()) : "local";
		return Collections.singletonMap("state", state);
	}

	/** A server's host name (its address when it has none) */
	public static String hostOf(String server) {
		if (server == null) {
			return null;
		}
		try {
			String host = java.net.URI.create(server).getHost();
			return host == null ? server : host;
		} catch (IllegalArgumentException e) {
			return server;
		}
	}

	/** The name of the survey open, as the pages show it (AppInfoController), else its survey_name */
	private String surveyName() {
		CollectSurvey survey = surveyService == null ? null : surveyService.getCollectSurvey();
		String name = survey == null ? null : EarthSurveyService.projectName(survey, properties.getUiLanguage().getLocale().getLanguage());
		return StringUtils.defaultIfBlank(name, StringUtils.trimToNull(properties.getValue(EarthProperty.SURVEY_NAME)));
	}

	/**
	 * The Log in button of the settings (the Swing DatabaseServerPanel's): a login against the server typed there, not
	 * saved yet. Nothing is saved: the token goes into its field, and Apply saves it with the rest.
	 */
	public String token(String url, String username, String password) throws InvalidCloudRequestException {
		return token(url, username, password, null);
	}

	/** {@link #token(String, String, String)} with the code of two-step sign-in, once the server asked for it. */
	public String token(String url, String username, String password, String code) throws InvalidCloudRequestException {
		if (StringUtils.isBlank(url)) {
			throw new InvalidCloudRequestException("cloud.urlRequired", Messages.getString("DatabaseServerPanel.cloudUrlRequired"));
		}
		JoinRequest credentials = new JoinRequest();
		credentials.username = username;
		credentials.password = password;
		return authenticate(() -> login(url.trim(), username.trim(), password, code, null), credentials);
	}

	/** The login, with the code and the invitation only when there are some (the three-argument call otherwise, as before). */
	private String login(String baseUrl, String username, String password, String code, String inviteToken) throws IOException {
		if (StringUtils.isNotBlank(inviteToken)) {
			return api.login(baseUrl, username, password, StringUtils.trimToNull(code), inviteToken);
		}
		return StringUtils.isBlank(code) ? api.login(baseUrl, username, password) : api.login(baseUrl, username, password, code);
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
		} catch (CloudApiClient.SecondStepException e) {
			// Not a failure to report as such: the page asks for the code (required), or says it is wrong
			switch (e.getKind()) {
			case "required":
				throw new InvalidCloudRequestException("cloud.secondStepRequired", Messages.getString("CloudLoginDialog.secondStepRequired"));
			case "unreadable":
				throw new InvalidCloudRequestException("cloud.secondStepUnreadable", Messages.getString("CloudLoginDialog.secondStepUnreadable"));
			default:
				throw new InvalidCloudRequestException("cloud.secondStepInvalid", Messages.getString("CloudLoginDialog.secondStepInvalid"));
			}
		} catch (CloudApiException e) {
			logger.warn("The cloud login failed: {}", e.getMessage());
			// A server with a stricter rule than this version knows: still said in plain words
			if ("weak_password".equals(e.getErrorCode())) {
				throw new InvalidCloudRequestException("cloud.weakPassword", Messages.getString("CloudLoginDialog.passwordTooShort"));
			}
			throw new InvalidCloudRequestException("cloud.login", StringUtils.defaultIfBlank(e.getMessage(), Messages.getString("CloudLoginDialog.failed")));
		} catch (IOException | RuntimeException e) {
			logger.warn("The cloud login failed: {}", e.getMessage());
			throw new InvalidCloudRequestException("cloud.login", StringUtils.defaultIfBlank(e.getMessage(), Messages.getString("CloudLoginDialog.failed")));
		}
		if (StringUtils.isBlank(token)) {
			throw new InvalidCloudRequestException("cloud.noToken", Messages.getString("CloudLoginDialog.noToken"));
		}
		return token;
	}

	/** How many times, and how long apart, the feedback of a plot just submitted is asked while its record is on its way */
	static final int FEEDBACK_TRIES = 5;
	static final long FEEDBACK_WAIT_MS = 1500;

	/**
	 * The training feedback of a plot just submitted (a learning set's): the sync is started so the record reaches the
	 * server, and the server is asked again while it says pending. {@code status} none outside the cloud mode, or when the
	 * server cannot be reached (the form then shows nothing).
	 */
	public Map<String, Object> trainingFeedback(String placemarkId) {
		if (!properties.isCloudSyncEnabled() || StringUtils.isBlank(placemarkId)) {
			return Collections.singletonMap("status", "none");
		}
		sync.syncNowAsync();
		Map<String, Object> answer = Collections.singletonMap("status", "none");
		for (int i = 0; i < FEEDBACK_TRIES; i++) {
			try {
				com.fasterxml.jackson.databind.JsonNode node = api.getTrainingFeedback(placemarkId);
				@SuppressWarnings("unchecked")
				Map<String, Object> map = new com.fasterxml.jackson.databind.ObjectMapper().convertValue(node, Map.class);
				answer = map;
			} catch (IOException | RuntimeException e) {
				logger.warn("Could not get the training feedback of {}: {}", placemarkId, e.getMessage());
				return Collections.singletonMap("status", "none");
			}
			if (!"pending".equals(answer.get("status")) || i == FEEDBACK_TRIES - 1) {
				break;
			}
			try {
				Thread.sleep(waitMs);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				break;
			}
		}
		return answer;
	}

	/** The wait between two asks (shorter in tests) */
	long waitMs = FEEDBACK_WAIT_MS;

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

	/**
	 * The plot files the cloud server assigns to the operator, as the Sample data tab of the Swing settings listed them in
	 * cloud mode; the one in use (the plots file has its name) is marked.
	 */
	public List<Map<String, Object>> assignments() throws InvalidCloudRequestException {
		List<Map<String, Object>> list = new ArrayList<>();
		String current = StringUtils.defaultString(properties.getValue(EarthProperty.SAMPLE_FILE));
		for (AssignmentInfo info : fetchAssignments()) {
			Map<String, Object> entry = new LinkedHashMap<>();
			entry.put("id", info.getCsvFileId());
			entry.put("filename", info.getFilename());
			entry.put("plots", info.getPlotCount());
			entry.put("active", info.getFilename() != null && new File(current).getName().equals(new File(info.getFilename()).getName()));
			list.add(entry);
		}
		return list;
	}

	/**
	 * Downloads an assigned plot file into the project's assignments folder (checked against its checksum by the client),
	 * for the settings page to use as the plots file. @return where it was written
	 */
	public File downloadAssignment(String id) throws InvalidCloudRequestException {
		for (AssignmentInfo info : fetchAssignments()) {
			if (info.getCsvFileId() != null && info.getCsvFileId().equals(id)) {
				try {
					File file = api.downloadAssignedCsv(info, assignmentsFolder());
					startAfresh(info, file);
					return file;
				} catch (IOException | RuntimeException e) {
					logger.warn("Could not download the assigned CSV {}: {}", info.getFilename(), e.getMessage());
					throw new InvalidCloudRequestException("cloud.download", Messages.getString("SampleDataPanel.downloadError"));
				}
			}
		}
		throw new InvalidCloudRequestException("cloud.noAssignment", Messages.getString("SampleDataPanel.downloadError"));
	}

	/**
	 * A learning set's file in a new attempt: the interpreter's records of its plots saved before the attempt started
	 * are deleted, so they assess the plots afresh (never failing the download).
	 */
	private void startAfresh(AssignmentInfo info, File file) {
		if (info.getFreshSince() == null || surveyService == null) {
			return;
		}
		try {
			List<String[]> keys = plotKeys(file, surveyService.getKeyAttributeCount());
			int deleted = surveyService.deleteRecordsSavedBefore(keys, info.getFreshSince());
			logger.info("New attempt at {}: {} earlier records deleted", info.getFilename(), deleted);
			if (deleted > 0) {
				GAlogger.logGAnalytics("TrainingAttemptStartedAfresh");
			}
		} catch (IOException | RuntimeException e) {
			// An error, so Sentry has it (its appender is bound at ERROR): the interpreter would see earlier answers.
			logger.error("Could not start a learning set's new attempt afresh", e);
		}
	}

	/**
	 * The key values of each row of a plot file (its first {@code keyCount} columns, quotes taken off; the separator is
	 * the comma, semicolon or tab the header row uses most). A header row is read as a key too: no plot has it.
	 */
	static List<String[]> plotKeys(File csv, int keyCount) throws IOException {
		List<String> lines = java.nio.file.Files.readAllLines(csv.toPath(), java.nio.charset.StandardCharsets.UTF_8);
		List<String[]> keys = new ArrayList<>();
		if (lines.isEmpty() || keyCount < 1) {
			return keys;
		}
		String first = lines.get(0).replace("\uFEFF", "");
		char separator = ',';
		int most = StringUtils.countMatches(first, ',');
		for (char candidate : new char[] { ';', '\t' }) {
			int count = StringUtils.countMatches(first, candidate);
			if (count > most) {
				most = count;
				separator = candidate;
			}
		}
		for (String line : lines) {
			String row = line.replace("\uFEFF", "");
			if (StringUtils.isBlank(row)) {
				continue;
			}
			String[] fields = row.split(java.util.regex.Pattern.quote(String.valueOf(separator)), -1);
			if (fields.length < keyCount) {
				continue;
			}
			String[] key = new String[keyCount];
			for (int i = 0; i < keyCount; i++) {
				key[i] = StringUtils.strip(fields[i].trim(), "\"");
			}
			keys.add(key);
		}
		return keys;
	}

	private List<AssignmentInfo> fetchAssignments() throws InvalidCloudRequestException {
		try {
			return api.getMyAssignments();
		} catch (IOException | RuntimeException e) {
			logger.warn("Could not load the cloud assignments: {}", e.getMessage());
			throw new InvalidCloudRequestException("cloud.assignments", Messages.getString("SampleDataPanel.assignmentsError"));
		}
	}

	/** {@code <project folder>/assignments}, a stable home for the downloaded files, as the Swing tab had it */
	File assignmentsFolder() {
		return assignmentsFolderOf(properties.getImdFile());
	}

	/**
	 * The folder of the plot files assigned to the operator in the project whose survey is at {@code idmPath}: in a cloud
	 * project the plots file can only be one of them (SettingsValidator).
	 */
	public static File assignmentsFolderOf(String idmPath) {
		File idm = new File(StringUtils.defaultString(idmPath)).getAbsoluteFile();
		return new File(idm.getParentFile(), "assignments");
	}
}
