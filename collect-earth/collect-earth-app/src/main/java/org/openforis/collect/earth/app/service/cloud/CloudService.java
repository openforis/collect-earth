package org.openforis.collect.earth.app.service.cloud;

import org.openforis.collect.earth.app.service.SafetyCopy;
import org.openforis.collect.earth.app.service.notices.NoticeService;
import org.openforis.collect.earth.app.service.notices.Notice;
import java.util.Set;
import java.util.LinkedHashSet;
import java.util.Arrays;
import java.io.File;
import java.io.IOException;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.logging.GAlogger;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.CloudBinding;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.AssignmentInfo;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.CloudApiException;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.JoinPreview;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.MyAssignment;
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
		/** Join with the account signed in here to the invitation's server (the preview's {@code account}), no password */
		public boolean useAccount;
	}

	private static final String JOIN_MARKER = "/join/";

	private final Logger logger = LoggerFactory.getLogger(CloudService.class);
	private final CloudApiClient api;
	private final CloudSyncService sync;
	private final EarthProjectsService projects;
	private final LocalPropertiesService properties;
	/**
	 * Held while a project is downloaded and unzipped (a join, a project opened, a changed survey taken): two at once
	 * would unzip into the same folder, and the second is refused.
	 */
	private final ReentrantLock opening = new ReentrantLock();

	/** Takes a safety copy of a project folder with the database and the settings (SafetyCopy.make) */
	interface SafetyCopier {
		File copy(String reason, File projectFolder) throws IOException;
	}

	/** The real one writes into the data folder's safetyCopies; tests give their own */
	private SafetyCopier safetyCopier = SafetyCopy::make;

	void setSafetyCopier(SafetyCopier safetyCopier) {
		this.safetyCopier = safetyCopier;
	}

	/** To start a learning set's new attempt afresh (deleting earlier records); absent in some tests. */
	private EarthSurveyService surveyService;

	/** The person's plots (downloaded at the join; a training set opened instead of them); absent in some tests. */
	private MyPlotsService myPlots;

	@Autowired(required = false)
	public void setMyPlots(MyPlotsService myPlots) {
		this.myPlots = myPlots;
	}

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
		JoinPreview preview;
		try {
			preview = api.getJoinPreview(invitation[0], invitation[1]);
		} catch (CloudApiClient.CloudApiException e) {
			// The server answers 404 for a link it does not know (mistyped, cut short): said as an invalid invitation, not
			// as an internal error with no message (found by the workflow runs, docs/plans/2026-11-15-workflow-review.md)
			if (e.getStatus() == 404) {
				throw new InvalidCloudRequestException("cloud.inviteInvalid", Messages.getString("CloudJoin.inviteInvalid"));
			}
			throw e;
		}
		if (preview == null || !preview.isValid()) {
			throw new InvalidCloudRequestException("cloud.inviteInvalid", Messages.getString("CloudJoin.inviteInvalid"));
		}
		Map<String, Object> answer = new LinkedHashMap<>();
		answer.put("baseUrl", invitation[0]);
		answer.put("inviteToken", invitation[1]);
		answer.put("projectId", preview.getProjectId());
		answer.put("projectName", preview.getProjectName());
		answer.put("role", preview.getRole());
		// Signed in to that server already (another project's join): the page offers to join with that account
		answer.put("account", signedInAccount(invitation[0]));
		return answer;
	}

	/** The account signed in here to that server (its session kept), or null */
	private String signedInAccount(String baseUrl) {
		return StringUtils.trimToNull(properties.getCloudAccounts().get(LocalPropertiesService.normalizeServer(baseUrl)));
	}

	/**
	 * Logs in or registers, downloads the project and loads it, and switches to cloud mode: the caller restarts. A
	 * failure leaves the configuration as it was.
	 */
	public void join(JoinRequest request) throws InvalidCloudRequestException, IOException {
		if (request.useAccount) {
			joinSignedIn(request);
			return;
		}
		String username = StringUtils.trimToEmpty(request.username);
		// Said here, in the user's language, before the server is asked: it refuses the same (weak_password)
		if (request.register && StringUtils.isNotEmpty(request.password) && StringUtils.isNotBlank(username)
				&& request.password.length() < MIN_PASSWORD_LENGTH) {
			throw new InvalidCloudRequestException("cloud.weakPassword", Messages.getString("CloudLoginDialog.passwordTooShort"));
		}
		// Log in with the invitation: someone who has an account (another project's) joins this one with it
		String token = request.register ? authenticate(() -> api.register(request.baseUrl, username, request.password, request.inviteToken), request)
				: authenticate(() -> login(request.baseUrl, username, request.password, request.code, request.inviteToken), request);
		joined(request, token, username);
	}

	private void joined(JoinRequest request, String token, String username) throws InvalidCloudRequestException, IOException {
		// The name typed on this computer until now: its records are this person's (CloudRecordsSender sends those)
		CloudRecordsSender.rememberLocalName(properties, properties.getOperator());
		useProject(request.baseUrl, request.projectId, token, username);
		// The next start offers to send the records this computer already has (CloudRecordsSender)
		properties.setValue(EarthProperty.CLOUD_OFFER_LOCAL_RECORDS, Boolean.TRUE.toString());
	}

	/**
	 * {@link #join} with the session kept for the invitation's server: the server joins that session's account, so no
	 * password is asked. Not signed in there, or the session ended (401; 404 from an older server): cloud.signInAgain,
	 * and the page asks for the user name and password as before.
	 */
	private void joinSignedIn(JoinRequest request) throws InvalidCloudRequestException, IOException {
		String username = signedInAccount(request.baseUrl);
		String token = username == null ? null : properties.getCloudToken(request.baseUrl);
		InvalidCloudRequestException signIn = new InvalidCloudRequestException("cloud.signInAgain", Messages.getString("CloudJoin.signInAgain"));
		if (StringUtils.isBlank(token)) {
			throw signIn;
		}
		try {
			api.joinWithSession(request.baseUrl, token, request.inviteToken);
		} catch (CloudApiException e) {
			logger.warn("Joining with the session kept failed: {}", e.getMessage());
			if (e.getStatus() == 401 || e.getStatus() == 404) {
				throw signIn;
			}
			if ("invite_exhausted".equals(e.getErrorCode()) || "invalid_invite".equals(e.getErrorCode())) {
				throw new InvalidCloudRequestException("cloud.inviteInvalid", Messages.getString("CloudJoin.inviteInvalid"));
			}
			if ("rate_limited".equals(e.getErrorCode())) {
				throw new InvalidCloudRequestException("cloud.rateLimited", Messages.getString("CloudLoginDialog.rateLimited"));
			}
			throw e;
		}
		joined(request, token, username);
	}

	/**
	 * Downloads the project and loads it, binds its folder to the cloud project (the other projects keep theirs), keeps
	 * the server's sign-in, and switches to cloud mode for it: the caller restarts.
	 */
	private void useProject(String baseUrl, String projectId, String token, String username) throws InvalidCloudRequestException, IOException {
		if (!opening.tryLock()) {
			throw new InvalidCloudRequestException("cloud.busy", Messages.getString("CloudJoin.busy")); //$NON-NLS-1$ //$NON-NLS-2$
		}
		try {
			useProjectNow(baseUrl, projectId, token, username);
		} finally {
			opening.unlock();
		}
	}

	/** Whether a project is being downloaded and unzipped now ({@link #useProject}) */
	boolean isOpening() {
		return opening.isLocked();
	}

	private void useProjectNow(String baseUrl, String projectId, String token, String username) throws InvalidCloudRequestException, IOException {
		String server = LocalPropertiesService.normalizeServer(baseUrl);
		// The training set open in this very project (a changed survey taken during a training): open again after
		File training = isOpen(server, projectId) ? openTrainingFile() : null;
		File cep = api.downloadCep(baseUrl, projectId, token);
		String revision;
		try {
			File folder = projects.projectFolderFor(cep);
			refuseToReplaceUnsent(folder, projectId);
			// The survey just downloaded, as the server names it: from the file itself, not asked after, when the
			// coordinator may have changed it again (a later one is offered by SurveyUpdateService)
			revision = SurveyRevision.ofProjectFile(cep);
			CloudBinding bound = folder == null ? null : properties.getCloudBinding(folder);
			boolean sameProject = bound != null && StringUtils.equals(bound.projectId, projectId);
			// A project of this computer in no cloud project (one of Collect Earth 1, say) with the same survey: its files
			// are about to be replaced and its survey updated to the cloud project's, so they are copied first
			File safetyCopy = bound == null ? copyLocalProject(folder) : null;
			if (sameProject) {
				sendBeforeTheSurveyChanges(cep, folder, bound, server, projectId, revision);
			}
			// The files replaced, kept until the new survey is loaded at the start (EarthSurveyService)
			SurveyUpdateBackup.keep(cep, folder);
			try {
				projects.loadCompressedProjectFile(cep, true);
			} catch (IOException | RuntimeException e) {
				restoreAfterFailure(folder);
				throw e;
			}
			if (safetyCopy != null) {
				SafetyCopy.tellAtNextStart(properties, SafetyCopy.BEFORE_JOIN, safetyCopy, folder.getName());
			}
			if (!sameProject) {
				// The folder was another project's (or a local one), and is bound to this one now: its files are not put
				// back at the start, which would leave them bound to this project
				SurveyUpdateBackup.discard(folder);
			}
		} finally {
			if (cep != null && !cep.delete()) {
				cep.deleteOnExit();
			}
		}
		CloudBinding binding = new CloudBinding(properties.getProjectFolder(), server, projectId, null, username);
		describe(api, binding, token);
		binding.surveyRevision = revision;
		properties.saveCloudBinding(binding);
		properties.saveCloudToken(server, username, token);
		if (StringUtils.isNotBlank(username)) {
			properties.saveOperator(username);
		}
		properties.setCloudSyncEnabled(true);
		// An office computer (on its shared PostgreSQL) goes back to it when a project that is not a cloud one is opened
		CollectDBDriver before = properties.getCollectDBDriver();
		if (before == CollectDBDriver.POSTGRESQL) {
			properties.setValue(EarthProperty.DB_DRIVER_BEFORE_CLOUD, before.name());
		} else if (before == CollectDBDriver.SQLITE) {
			properties.setValue(EarthProperty.DB_DRIVER_BEFORE_CLOUD, "");
		}
		properties.saveCollectDBDriver(CollectDBDriver.CLOUD);
		// The next start brings the account's own records of the project to this computer (CloudOwnRecordsFetcher)
		CloudOwnRecordsFetcher.requestAtNextStart(properties);
		// The person's plots, so the first start shows them (an older server: the assigned plot file at the start)
		if (myPlots != null) {
			myPlots.atJoin(new CloudApiClient.Destination(server, projectId, token));
			// Taking a changed survey during a training goes back to it, not to the person's own plots
			if (training != null && training.isFile()) {
				myPlots.openTraining(training);
			}
		}
	}

	/** Whether the project open is that cloud project */
	private boolean isOpen(String server, String projectId) {
		return properties.isCloudSyncEnabled() && StringUtils.equals(projectId, properties.getCloudProjectId())
				&& server.equals(LocalPropertiesService.normalizeServer(properties.getCloudSyncUrl()));
	}

	/** The files of before put back after a project file that could not be unzipped or loaded over them */
	private void restoreAfterFailure(File folder) {
		try {
			SurveyUpdateBackup.restore(folder);
		} catch (IOException | RuntimeException e) {
			logger.error("The files of {} could not be put back after a failed download", folder, e); //$NON-NLS-1$
		}
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
	/**
	 * The project of this computer that a cloud project's file is about to replace, copied with the database and the
	 * settings (SafetyCopy) when it is one: a folder with a project definition that is in no cloud project. The join is
	 * refused when the copy cannot be taken, rather than replace a project with no copy of it.
	 *
	 * @return the copy, or null when the folder holds no project
	 */
	private File copyLocalProject(File folder) throws InvalidCloudRequestException {
		if (folder == null || !folder.isDirectory() || !new File(folder, EarthProjectsService.PROJECT_PROPERTIES_FILE_NAME).isFile()) {
			return null;
		}
		try {
			return safetyCopier.copy("before-joining-" + folder.getName(), folder); //$NON-NLS-1$
		} catch (IOException | RuntimeException e) {
			logger.error("The project {} could not be copied before joining", folder, e); //$NON-NLS-1$
			throw new InvalidCloudRequestException("cloud.safetyCopyFailed", //$NON-NLS-1$
					MessageFormat.format(Messages.getString("CloudJoin.safetyCopyFailed"), folder.getName(), String.valueOf(e.getMessage()))); //$NON-NLS-1$
		}
	}

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
	 * The same cloud project opened again (from the list of projects, an invitation, "Update now") with a survey that is
	 * not the one its folder has: its records not sent yet were made with the survey of before, and must reach the server
	 * in its shape before the changed one is unzipped over it (read with the changed survey after the restart, the answers
	 * of the questions taken away would be lost). The project open: sent now, refused when some cannot be. Another one:
	 * refused, as it must be opened as it is for them to be sent (the queue sends only the project open's).
	 */
	private void sendBeforeTheSurveyChanges(File cep, File folder, CloudBinding bound, String server, String projectId, String revision)
			throws InvalidCloudRequestException {
		if (revision == null || folder == null || !folder.isDirectory()) {
			return;
		}
		boolean open = isOpen(server, projectId);
		String here = open && surveyService != null ? StringUtils.trimToNull(surveyService.getLoadedSurveyRevision()) : null;
		if (here == null) {
			here = SurveyRevision.ofFolderFor(cep, folder);
		}
		if (here == null) {
			here = StringUtils.trimToNull(bound.surveyRevision);
		}
		if (revision.equals(here)) {
			return; // the same survey: nothing is read differently
		}
		String name = StringUtils.defaultIfBlank(bound.projectName, folder.getName());
		if (open) {
			if (surveyService != null) {
				surveyService.flushAll();
			}
			CloudSyncService.Unsent unsent = sync.sendNow(SurveyUpdateService.SEND_TIMEOUT_MS);
			if (unsent != null && unsent.getToSend() > 0) {
				throw new InvalidCloudRequestException("cloud.unsentRecords", //$NON-NLS-1$
						MessageFormat.format(Messages.getString("CloudJoin.unsentSurveyChanged"), unsent.getToSend(), name)); //$NON-NLS-1$
			}
			return;
		}
		int unsent = sync.toSendCount(projectId);
		if (unsent > 0) {
			throw new InvalidCloudRequestException("cloud.unsentRecords", //$NON-NLS-1$
					MessageFormat.format(Messages.getString("CloudJoin.unsentOpenFirst"), unsent, name)); //$NON-NLS-1$
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
			// Locked by the server after too many wrong passwords (its sign-in rules)
			if ("account_locked".equals(e.getErrorCode())) {
				throw new InvalidCloudRequestException("cloud.accountLocked", Messages.getString("CloudLoginDialog.accountLocked"));
			}
			// The refusals of joining, in plain words rather than the server's answer ("register failed with HTTP 409:
			// {"error":"username_taken"}" was shown as it was; docs/plans/2026-11-15-workflow-review.md)
			if ("username_taken".equals(e.getErrorCode())) {
				throw new InvalidCloudRequestException("cloud.usernameTaken", Messages.getString("CloudLoginDialog.usernameTaken"));
			}
			if ("invalid_credentials".equals(e.getErrorCode())) {
				throw new InvalidCloudRequestException("cloud.invalidCredentials", Messages.getString("CloudLoginDialog.invalidCredentials"));
			}
			if ("invite_exhausted".equals(e.getErrorCode()) || "invalid_invite".equals(e.getErrorCode())) {
				throw new InvalidCloudRequestException("cloud.inviteInvalid", Messages.getString("CloudJoin.inviteInvalid"));
			}
			// The server's limit per address: a training room joins from one office address, so when a big group joins
			// at once the last of a minute are told to wait, not shown the server's answer
			if ("rate_limited".equals(e.getErrorCode())) {
				throw new InvalidCloudRequestException("cloud.rateLimited", Messages.getString("CloudLoginDialog.rateLimited"));
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

	/** How long a plot's earlier answers are kept (the coordinator may change the header's questions meanwhile) */
	static final long PERIODS_KEPT_MS = 10L * 60 * 1000;
	private static final int PERIODS_KEPT = 200;
	private final Map<String, Object[]> periodsByPlot = Collections.synchronizedMap(new LinkedHashMap<String, Object[]>(16, 0.75f, true) {
		private static final long serialVersionUID = 1L;

		@Override
		protected boolean removeEldestEntry(Map.Entry<String, Object[]> eldest) {
			return size() > PERIODS_KEPT;
		}
	});

	/**
	 * A plot's answers in the earlier periods of a repeat survey, for the header of its form (docs/plans/2026-11-11-repeat-
	 * survey.md): as the server gives them, kept a few minutes per plot. No periods when the project is not on the cloud,
	 * repeats no survey, or the server cannot be reached: the form is then shown as for any project.
	 */
	public Map<String, Object> plotPeriods(String placemarkId) {
		Map<String, Object> none = Collections.singletonMap("periods", Collections.emptyList());
		if (!properties.isCloudSyncEnabled() || StringUtils.isBlank(placemarkId)) {
			return none;
		}
		String key = properties.getCloudProjectId() + "\u0000" + placemarkId;
		Object[] kept = periodsByPlot.get(key);
		long now = System.currentTimeMillis();
		if (kept != null && now - (Long) kept[0] < PERIODS_KEPT_MS) {
			@SuppressWarnings("unchecked")
			Map<String, Object> answer = (Map<String, Object>) kept[1];
			return answer;
		}
		try {
			@SuppressWarnings("unchecked")
			Map<String, Object> answer = new com.fasterxml.jackson.databind.ObjectMapper().convertValue(api.getPlotPeriods(placemarkId), Map.class);
			periodsByPlot.put(key, new Object[] { now, answer });
			return answer;
		} catch (IOException | RuntimeException e) {
			logger.warn("Could not get the earlier answers of {}: {}", placemarkId, e.getMessage());
			return none;
		}
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
			// A training set (calibration, learning): apart from the person's plots
			entry.put("training", info.getTrainingKind());
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
				return downloadAssignment(info);
			}
		}
		throw new InvalidCloudRequestException("cloud.noAssignment", Messages.getString("SampleDataPanel.downloadError"));
	}

	/**
	 * {@link #downloadAssignment(String)} of an assignment already listed: a learning set's file in a new attempt starts
	 * it afresh (see {@link #startAfresh}).
	 */
	File downloadAssignment(AssignmentInfo info) throws InvalidCloudRequestException {
		try {
			File file = api.downloadAssignedCsv(info, assignmentsFolder());
			startAfresh(info, file);
			return file;
		} catch (IOException | RuntimeException e) {
			logger.warn("Could not download the assigned CSV {}: {}", info.getFilename(), e.getMessage());
			throw new InvalidCloudRequestException("cloud.download", Messages.getString("SampleDataPanel.downloadError"));
		}
	}

	/**
	 * Opens a training set (calibration, learning) instead of the person's plots: downloaded (a learning set's new attempt
	 * starts afresh) and made the plots file, which stays until the person goes back to their plots. @return its path
	 */
	public File openTraining(String id) throws InvalidCloudRequestException {
		return opened(downloadAssignment(id));
	}

	/** {@link #openTraining(String)} of a set already listed */
	File openTraining(AssignmentInfo info) throws InvalidCloudRequestException {
		return opened(downloadAssignment(info));
	}

	private File opened(File file) {
		if (myPlots != null) {
			// with the check's own writes, which would otherwise put the person's plots back halfway through
			myPlots.openTraining(file);
		} else {
			properties.setValue(EarthProperty.SAMPLE_FILE, file.getAbsolutePath());
			properties.setValue(EarthProperty.CLOUD_TRAINING_FILE, file.getAbsolutePath());
		}
		EarthApp.reloadPlots();
		return file;
	}

	/** Where a training set waiting is offered at a start (absent in some tests) */
	private NoticeService notices;

	@Autowired(required = false)
	public void setNotices(NoticeService notices) {
		this.notices = notices;
	}

	/**
	 * At a start with the person's plots, and at the checks of TrainingPlotFiles: a training set the person takes part in
	 * (calibration, learning) is offered to open, once for each of its versions, unless one is open already. Never throws.
	 */
	public void offerTraining() {
		if (notices == null || myPlots == null || myPlots.onTraining()) {
			return;
		}
		try {
			offerTraining(fetchAssignments());
		} catch (InvalidCloudRequestException | RuntimeException e) {
			// asked again at the next start or check
		}
	}

	/**
	 * {@link #offerTraining()} of the sets listed. One set new to this computer, while the person holds no plot of their
	 * own (the first days of a project, when the team trains together: docs/plans/2026-11-17-training-the-team.md), is
	 * opened by itself and said; nobody's work is switched away. A learning set in a new attempt is only offered (taking
	 * it deletes earlier answers).
	 */
	void offerTraining(List<AssignmentInfo> listed) {
		if (notices == null || myPlots == null || myPlots.onTraining()) {
			return;
		}
		List<AssignmentInfo> sets = new ArrayList<>();
		Set<String> offered = new LinkedHashSet<>(Arrays.asList(StringUtils.defaultString(properties.getValue(EarthProperty.CLOUD_TRAINING_OFFERED)).split(",")));
		for (AssignmentInfo info : listed) {
			if (info.getTrainingKind() != null && info.getCsvFileId() != null && !offered.contains(info.getCsvFileId() + ":" + info.getChecksum())) {
				sets.add(info);
			}
		}
		if (sets.isEmpty()) {
			return;
		}
		AssignmentInfo first = sets.get(0);
		boolean newHere = offered.stream().noneMatch(entry -> entry.startsWith(first.getCsvFileId() + ":"));
		for (AssignmentInfo info : sets) {
			offered.add(info.getCsvFileId() + ":" + info.getChecksum());
		}
		offered.remove("");
		properties.setValue(EarthProperty.CLOUD_TRAINING_OFFERED, String.join(",", offered));
		if (sets.size() == 1 && newHere && first.getFreshSince() == null && myPlots.holdsNoPlots()) {
			try {
				openTraining(first);
				notices.post(new Notice(MyPlotsService.NOTICE, Notice.INFO, Messages.getString("MyPlots.title"), //$NON-NLS-1$
						MessageFormat.format(Messages.getString("CloudTraining.opened"), StringUtils.defaultIfBlank(first.getFilename(), first.getCsvFileId()), first.getPlotCount()))); //$NON-NLS-1$
				return;
			} catch (InvalidCloudRequestException e) {
				logger.warn("The training set {} could not be opened by itself: offered", first.getFilename()); //$NON-NLS-1$
			}
		}
		List<String> names = new ArrayList<>();
		for (AssignmentInfo info : sets) {
			names.add(StringUtils.defaultIfBlank(info.getFilename(), info.getCsvFileId()));
		}
		Notice notice = new Notice(MyPlotsService.NOTICE, Notice.INFO, Messages.getString("MyPlots.title"), //$NON-NLS-1$
				MessageFormat.format(Messages.getString("MyPlots.trainingOffer"), String.join(", ", names))); //$NON-NLS-1$ //$NON-NLS-2$
		for (AssignmentInfo info : sets) {
			notice.choice(info.getCsvFileId(), StringUtils.defaultIfBlank(info.getFilename(), info.getCsvFileId()),
					MessageFormat.format(Messages.getString("CloudPlotFile.plots"), info.getPlotCount())); //$NON-NLS-1$
		}
		notice.option(AssignedPlotFileSetup.LATER, Messages.getString("CloudPlotFile.later")); //$NON-NLS-1$
		notices.post(notice, chosen -> {
			try {
				if (!AssignedPlotFileSetup.LATER.equals(chosen)) {
					openTraining(chosen);
				}
			} catch (InvalidCloudRequestException e) {
				notices.post(new Notice(MyPlotsService.NOTICE, Notice.WARNING, Messages.getString("MyPlots.title"), e.getMessage())); //$NON-NLS-1$
			}
		});
	}

	/** The training set open (Settings › Project) is no longer running: back to the person's plots. @return whether it was */
	boolean leaveTraining() {
		return myPlots != null && myPlots.useMyPlots();
	}

	/** Whether the person's plots come from the server (not an older server's files of before) */
	boolean hasPersonsPlots() {
		return myPlots != null && !myPlots.isOlderServer();
	}

	/** The training set the person opened (CLOUD_TRAINING_FILE), while it is the plots file; null otherwise */
	File openTrainingFile() {
		return myPlots != null && myPlots.onTraining() ? new File(properties.getValue(EarthProperty.CLOUD_TRAINING_FILE)).getAbsoluteFile() : null;
	}

	/** The plot files the cloud server assigns to the operator in the open cloud project, as it lists them. */
	List<AssignmentInfo> assignedPlotFiles() throws InvalidCloudRequestException {
		return fetchAssignments();
	}

	/** {@link #assignedPlotFiles()} with the training that is over (TrainingPlotFiles) */
	MyAssignment myAssignment() throws InvalidCloudRequestException {
		try {
			MyAssignment mine = api.getMyAssignment();
			if (mine == null) {
				throw new IOException("No answer"); //$NON-NLS-1$
			}
			return mine;
		} catch (IOException | RuntimeException e) {
			logger.warn("Could not load the cloud assignments: {}", e.getMessage());
			throw new InvalidCloudRequestException("cloud.assignments", Messages.getString("SampleDataPanel.assignmentsError"));
		}
	}

	/**
	 * Deletes this computer's records of the plots of a training that is over (their record keys, the key values of a
	 * plot of several keys joined by commas). A plot that is also one of the person's plots (a training file may reuse
	 * the project's plot ids) or whose record is not sent yet is left alone. @return how many were deleted; -1 without a
	 * survey to delete them from, or when a record not sent yet was left (deleted at a later call, once sent)
	 */
	int deleteTrainingRecords(List<String> recordKeys) {
		if (surveyService == null || surveyService.getCollectSurvey() == null) {
			return -1;
		}
		Set<String> mine = new HashSet<>();
		if (myPlots != null) {
			for (String key : myPlots.plotKeys()) {
				mine.add(MyPlotsService.keyAsNumbers(key));
			}
		}
		int keyCount = Math.max(1, surveyService.getKeyAttributeCount());
		List<String[]> keys = new ArrayList<>();
		boolean unsentLeft = false;
		for (String recordKey : recordKeys) {
			String state = sync.recordState(recordKey);
			boolean unsent = "pending".equals(state) || "failed".equals(state); //$NON-NLS-1$ //$NON-NLS-2$
			if (mine.contains(MyPlotsService.keyAsNumbers(recordKey)) || unsent) {
				logger.info("The record of the training plot {} is kept: one of the person's plots, or not sent yet", recordKey); //$NON-NLS-1$
				unsentLeft |= unsent && !mine.contains(MyPlotsService.keyAsNumbers(recordKey));
				continue;
			}
			keys.add(keyCount == 1 ? new String[] { recordKey } : recordKey.split(",", keyCount)); //$NON-NLS-1$
		}
		int deleted = surveyService.deleteRecordsOf(keys);
		return unsentLeft ? -1 : deleted;
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
