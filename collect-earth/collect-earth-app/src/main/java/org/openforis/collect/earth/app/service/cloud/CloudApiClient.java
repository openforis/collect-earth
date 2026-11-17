package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.annotation.PreDestroy;

import org.apache.commons.lang3.StringUtils;
import org.apache.http.HttpEntity;
import org.apache.http.StatusLine;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.entity.GzipCompressingEntity;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.methods.HttpPut;
import org.apache.http.client.methods.HttpRequestBase;
import org.apache.http.entity.ByteArrayEntity;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.util.EntityUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.UpdateIniUtils;
import org.openforis.collect.earth.app.service.cloud.CloudRecordSerializer.RecordEnvelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Thin HTTP client for the Collect Earth cloud sync REST API.
 *
 * All calls are authenticated with a Bearer token, target a single project and
 * use short connection/socket timeouts so that a stalled network never blocks
 * the desktop UI. Record batches are gzip-compressed on the wire. The client
 * owns a single lazily-created {@link CloseableHttpClient} that is released on
 * bean destruction.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
@Component
public class CloudApiClient {

	private static final int TIMEOUT_MS = 30_000;
	/**
	 * Sent on every call: "CollectEarth/&lt;version&gt; cloud-sync". The server reads the
	 * version from it (the coordinators' dashboard shows who runs an old Collect Earth).
	 * Computed once, from update.ini.
	 */
	private static final String USER_AGENT = userAgentFor(installedVersion());
	private static final String UNKNOWN_VERSION = "unknown";
	private static final int ERROR_BODY_EXCERPT = 500;

	private final Logger logger = LoggerFactory.getLogger(CloudApiClient.class);
	private final ObjectMapper objectMapper = new ObjectMapper();

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private volatile CloseableHttpClient httpClient;

	/**
	 * A call the server refused: its HTTP status and the {@code error} code of its JSON answer
	 * ({@code weak_password}, {@code invalid_invite}...), null when it had none. The message stays
	 * "operation failed with HTTP status: body", as before.
	 */
	public static class CloudApiException extends IOException {
		private static final long serialVersionUID = 1L;
		private final int status;
		private final String errorCode;

		public CloudApiException(String message, int status, String errorCode) {
			super(message);
			this.status = status;
			this.errorCode = errorCode;
		}

		public int getStatus() {
			return status;
		}

		public String getErrorCode() {
			return errorCode;
		}
	}

	/** Result of trying to store a single record within a batch upload. */
	public static class BatchResult {
		private final String recordKey;
		private final String status;
		private final String reason;

		public BatchResult(String recordKey, String status, String reason) {
			this.recordKey = recordKey;
			this.status = status;
			this.reason = reason;
		}

		public String getRecordKey() {
			return recordKey;
		}

		/** One of {@code stored}, {@code stale}, {@code conflict} or {@code error}. */
		public String getStatus() {
			return status;
		}

		public String getReason() {
			return reason;
		}
	}

	/**
	 * Where the calls go: a server, one of its projects and the token sent as Bearer. The cloud project of the
	 * settings is one ({@link #cloudDestination()}); the local dashboard (service.dashboard) is another, fed with
	 * the same records:batch, project file and plot file uploads.
	 */
	public static final class Destination {
		private final String baseUrl;
		private final String projectId;
		private final String token;

		public Destination(String baseUrl, String projectId, String token) {
			this.baseUrl = normalize(baseUrl);
			this.projectId = projectId;
			this.token = token;
		}

		public String getBaseUrl() {
			return baseUrl;
		}

		public String getProjectId() {
			return projectId;
		}

		public String getToken() {
			return token;
		}

		/** The address of a route of the project: {@code path} starts with a slash. */
		String projectUrl(String path) {
			return baseUrl + "/v1/projects/" + projectId + path;
		}
	}

	/** The cloud project of the settings. */
	public Destination cloudDestination() {
		return new Destination(baseUrl(), projectId(), token());
	}

	/**
	 * Replaces a file of the project with a raw body: the project file ({@code /cep}, a zip) or a plot file
	 * ({@code /csv-files/<name>}, the name URL-encoded by the caller).
	 */
	public void putProjectFile(Destination destination, String path, byte[] body, ContentType contentType) throws IOException {
		HttpPut request = new HttpPut(destination.projectUrl(path));
		prepareWith(request, destination.getToken());
		request.setEntity(new ByteArrayEntity(body, contentType));
		try (CloseableHttpResponse response = client().execute(request)) {
			int status = response.getStatusLine().getStatusCode();
			if (!isSuccess(status)) {
				throw errorFor("putProjectFile " + path, status, response);
			}
			EntityUtils.consumeQuietly(response.getEntity());
		}
	}

	/**
	 * A new one-time sign-in link of a local dashboard (LOCAL_MODE of collect-earth-cloud): the address the browser
	 * opens, signed in, within 15 minutes.
	 */
	public String newLocalSignInUrl(Destination destination) throws IOException {
		HttpPost request = new HttpPost(destination.getBaseUrl() + "/v1/local/sign-in-links");
		prepareWith(request, destination.getToken());
		String url = textOrNull(executeForJson("newLocalSignInUrl", request), "url");
		if (url == null || url.isEmpty()) {
			throw new IOException("The dashboard did not answer with a sign-in link");
		}
		return url;
	}

	/**
	 * The cloud project as its member sees it (GET /v1/projects/:id): its id, its name as the coordinator gave it, and
	 * the role of the account in it (admin, reviewer, operator).
	 */
	public JoinPreview getProject(Destination destination) throws IOException {
		HttpGet request = new HttpGet(destination.projectUrl(""));
		prepareWith(request, destination.getToken());
		JsonNode project = executeForJson("getProject", request);
		return new JoinPreview(textOrNull(project, "projectId"), textOrNull(project, "name"), textOrNull(project, "role"), true);
	}

	/** Whether the account is the server's administrator (GET /v1/me, isPlatformAdmin); null when the server does not say. */
	public Boolean isServerAdmin(String baseUrl, String token) throws IOException {
		HttpGet request = new HttpGet(normalize(baseUrl) + "/v1/me");
		prepareWith(request, token);
		JsonNode admin = executeForJson("me", request).get("isPlatformAdmin");
		return admin != null && admin.isBoolean() ? admin.asBoolean() : null;
	}

	/** Uploads the survey IDML definition, base64-encoded, so the cloud project can decode records. */
	public void uploadSurveyDefinition(File idmlFile, String surveyUri) throws IOException {
		byte[] idmlBytes = Files.readAllBytes(idmlFile.toPath());
		ObjectNode body = objectMapper.createObjectNode();
		body.put("surveyUri", surveyUri);
		body.put("idmlBase64", Base64.getEncoder().encodeToString(idmlBytes));

		HttpPut request = new HttpPut(baseUrl() + "/v1/projects/" + projectId() + "/survey");
		prepare(request);
		request.setEntity(jsonEntity(body.toString()));
		try (CloseableHttpResponse response = client().execute(request)) {
			int status = response.getStatusLine().getStatusCode();
			if (!isSuccess(status)) {
				throw errorFor("uploadSurveyDefinition", status, response);
			}
		}
	}

	/**
	 * Uploads a batch of record envelopes (or tombstones) in a single gzipped POST
	 * and returns the per-record store results in the order the server reports them.
	 */
	public List<BatchResult> uploadRecordsBatch(List<RecordEnvelope> envelopes) throws IOException {
		return uploadRecordsBatch(cloudDestination(), envelopes);
	}

	/** The same as {@link #uploadRecordsBatch(List)}, to another server than the cloud project of the settings. */
	public List<BatchResult> uploadRecordsBatch(Destination destination, List<RecordEnvelope> envelopes) throws IOException {
		ObjectNode root = objectMapper.createObjectNode();
		ArrayNode records = root.putArray("records");
		for (RecordEnvelope envelope : envelopes) {
			records.add(toJson(envelope));
		}

		HttpPost request = new HttpPost(destination.projectUrl("/records:batch"));
		prepareWith(request, destination.getToken());
		StringEntity payload = new StringEntity(root.toString(), ContentType.APPLICATION_JSON);
		request.setEntity(new GzipCompressingEntity(payload));

		try (CloseableHttpResponse response = client().execute(request)) {
			int status = response.getStatusLine().getStatusCode();
			HttpEntity entity = response.getEntity();
			String responseBody = entity == null ? "" : EntityUtils.toString(entity, StandardCharsets.UTF_8);
			if (!isSuccess(status)) {
				throw errorFor("uploadRecordsBatch", status, responseBody);
			}
			return parseBatchResults(responseBody);
		}
	}

	private ObjectNode toJson(RecordEnvelope envelope) {
		ObjectNode node = objectMapper.createObjectNode();
		node.put("recordKey", envelope.getRecordKey());
		node.put("surveyUri", envelope.getSurveyUri());
		node.put("operator", envelope.getOperator());
		node.put("modifiedOn", envelope.getModifiedOn() == null ? null : Long.valueOf(envelope.getModifiedOn().getTime()));
		node.put("activelySaved", envelope.isActivelySaved());
		node.put("step", envelope.getStep());
		node.put("xml", envelope.getXml());
		node.put("deleted", envelope.isDeleted());
		node.put("payloadVersion", envelope.getPayloadVersion());
		if (envelope.getActiveSeconds() != null) {
			node.put("activeSeconds", envelope.getActiveSeconds().intValue());
		}
		ObjectNode summary = node.putObject("summary");
		if (envelope.getSummary() != null) {
			for (java.util.Map.Entry<String, String> entry : envelope.getSummary().entrySet()) {
				summary.put(entry.getKey(), entry.getValue());
			}
		}
		return node;
	}

	private List<BatchResult> parseBatchResults(String responseBody) throws IOException {
		List<BatchResult> results = new ArrayList<>();
		if (responseBody == null || responseBody.trim().isEmpty()) {
			return results;
		}
		JsonNode root = objectMapper.readTree(responseBody);
		JsonNode resultsNode = root.get("results");
		if (resultsNode != null && resultsNode.isArray()) {
			for (JsonNode result : resultsNode) {
				String recordKey = textOrNull(result, "recordKey");
				String status = textOrNull(result, "status");
				String reason = textOrNull(result, "reason");
				results.add(new BatchResult(recordKey, status, reason));
			}
		}
		return results;
	}

	private static String textOrNull(JsonNode node, String field) {
		JsonNode value = node.get(field);
		return value == null || value.isNull() ? null : value.asText();
	}

	/** Preview of a cloud project behind an invite URL, shown before the user commits to joining. */
	public static class JoinPreview {
		private final String projectId;
		private final String projectName;
		private final String role;
		private final boolean valid;

		public JoinPreview(String projectId, String projectName, String role, boolean valid) {
			this.projectId = projectId;
			this.projectName = projectName;
			this.role = role;
			this.valid = valid;
		}

		public String getProjectId() {
			return projectId;
		}

		public String getProjectName() {
			return projectName;
		}

		public String getRole() {
			return role;
		}

		public boolean isValid() {
			return valid;
		}
	}

	/**
	 * Logs in against an explicit server (used by the login dialog and the join flow,
	 * before any cloud properties are saved). Returns the opaque session token.
	 */
	public String login(String baseUrl, String username, String password) throws IOException {
		return login(baseUrl, username, password, null);
	}

	/**
	 * The server's answers about the second step of a sign-in (two-step sign-in, src/routes/twoFactor.ts of
	 * collect-earth-cloud): the account needs the code of its authenticator app ({@code required}), the code given is
	 * wrong or used ({@code invalid}), or the server cannot check it any more ({@code unreadable}).
	 */
	public static class SecondStepException extends IOException {
		private static final long serialVersionUID = 1L;
		private final String kind;

		public SecondStepException(String kind) {
			super("two-step sign-in: " + kind);
			this.kind = kind;
		}

		public String getKind() {
			return kind;
		}
	}

	/** {@link #login(String, String, String)} with the second step's code (an authenticator app's, or a recovery code). */
	public String login(String baseUrl, String username, String password, String code) throws IOException {
		return login(baseUrl, username, password, code, null);
	}

	/**
	 * {@link #login(String, String, String, String)} with an invitation: someone who has an account joins its project
	 * (Join cloud project, then Log in), as {@link #register} joins a new account to it. A server without that
	 * (before November 2026) ignores the invitation.
	 */
	public String login(String baseUrl, String username, String password, String code, String inviteToken) throws IOException {
		ObjectNode body = objectMapper.createObjectNode();
		body.put("username", username);
		body.put("password", password);
		if (code != null && !code.trim().isEmpty()) {
			body.put("code", code.trim());
		}
		if (inviteToken != null && !inviteToken.trim().isEmpty()) {
			body.put("inviteToken", inviteToken.trim());
		}
		HttpPost request = new HttpPost(normalize(baseUrl) + "/v1/auth/login");
		prepareNoAuth(request);
		request.setEntity(jsonEntity(body.toString()));
		try (CloseableHttpResponse response = client().execute(request)) {
			int status = response.getStatusLine().getStatusCode();
			HttpEntity entity = response.getEntity();
			String responseBody = entity == null ? "" : EntityUtils.toString(entity, StandardCharsets.UTF_8);
			if (!isSuccess(status)) {
				String kind = secondStepKind(status, responseBody);
				if (kind != null) {
					throw new SecondStepException(kind);
				}
				throw errorFor("login", status, responseBody);
			}
			return textOrNull(objectMapper.readTree(responseBody.isEmpty() ? "{}" : responseBody), "token");
		}
	}

	/** The second step's answer in a refused login, or null for any other refusal. */
	static String secondStepKind(int status, String body) {
		if (status != 401 || body == null) {
			return null;
		}
		if (body.contains("\"second_step_required\"")) {
			return "required";
		}
		if (body.contains("\"invalid_second_step\"")) {
			return "invalid";
		}
		if (body.contains("\"second_step_unreadable\"")) {
			return "unreadable";
		}
		return null;
	}

	/**
	 * Registers a new account using an invite token and returns the session token.
	 */
	public String register(String baseUrl, String username, String password, String inviteToken) throws IOException {
		ObjectNode body = objectMapper.createObjectNode();
		body.put("username", username);
		body.put("password", password);
		body.put("inviteToken", inviteToken);
		HttpPost request = new HttpPost(normalize(baseUrl) + "/v1/auth/register");
		prepareNoAuth(request);
		request.setEntity(jsonEntity(body.toString()));
		JsonNode response = executeForJson("register", request);
		return textOrNull(response, "token");
	}

	/**
	 * Takes an invitation with a session kept here (POST /v1/auth/join): the session's account joins its project, with no
	 * password. 401 when the session ended; 404 from a server without it (before November 2026).
	 */
	public void joinWithSession(String baseUrl, String token, String inviteToken) throws IOException {
		ObjectNode body = objectMapper.createObjectNode();
		body.put("inviteToken", inviteToken);
		HttpPost request = new HttpPost(normalize(baseUrl) + "/v1/auth/join");
		prepareWith(request, token);
		request.setEntity(jsonEntity(body.toString()));
		executeForJson("join", request);
	}

	/** Fetches the public preview of an invite (project name, role, validity). No auth. */
	public JoinPreview getJoinPreview(String baseUrl, String inviteToken) throws IOException {
		HttpGet request = new HttpGet(normalize(baseUrl) + "/v1/join/" + inviteToken);
		prepareNoAuth(request);
		JsonNode response = executeForJson("getJoinPreview", request);
		return new JoinPreview(textOrNull(response, "projectId"), textOrNull(response, "projectName"),
				textOrNull(response, "role"), response.has("valid") && response.get("valid").asBoolean());
	}

	/** The projects of the user the session token is of (GET /v1/projects, the dashboard's home page): id, name, role. */
	public List<JoinPreview> listProjects(String baseUrl, String token) throws IOException {
		HttpGet request = new HttpGet(normalize(baseUrl) + "/v1/projects");
		prepareWith(request, token);
		List<JoinPreview> projects = new ArrayList<>();
		for (JsonNode project : executeForJson("listProjects", request).path("projects")) {
			projects.add(new JoinPreview(textOrNull(project, "projectId"), textOrNull(project, "projectName"),
					textOrNull(project, "role"), true));
		}
		return projects;
	}

	/**
	 * Downloads the project's CEP zip to a temporary file, authenticated with the
	 * given session token. The caller loads it via EarthProjectsService and deletes it.
	 */
	public File downloadCep(String baseUrl, String projectId, String token) throws IOException {
		HttpGet request = new HttpGet(normalize(baseUrl) + "/v1/projects/" + projectId + "/cep");
		prepareWith(request, token);
		try (CloseableHttpResponse response = client().execute(request)) {
			int status = response.getStatusLine().getStatusCode();
			if (!isSuccess(status)) {
				throw errorFor("downloadCep", status, response);
			}
			HttpEntity entity = response.getEntity();
			if (entity == null) {
				throw new IOException("The cloud server returned an empty project file");
			}
			File tempFile = File.createTempFile("ce-cloud-project-", ".zip");
			try (java.io.OutputStream out = Files.newOutputStream(tempFile.toPath())) {
				entity.writeTo(out);
			}
			return tempFile;
		}
	}

	/** The account's own records of a cloud project, as a Collect Earth backup (GET my-records.zip): the file and how many. */
	public static final class OwnRecords {
		private final File file;
		private final int count;

		public OwnRecords(File file, int count) {
			this.file = file;
			this.count = count;
		}

		public File getFile() {
			return file;
		}

		public int getCount() {
			return count;
		}
	}

	/**
	 * The signed-in account's own records of the project on the server (GET my-records): each key with when it was last
	 * saved (ms), asked at each start and every few minutes (CloudOwnRecordsFetcher).
	 */
	public Map<String, Long> ownRecordKeys(Destination destination) throws IOException {
		HttpGet request = new HttpGet(destination.projectUrl("/my-records"));
		prepareWith(request, destination.getToken());
		JsonNode answer = executeForJson("ownRecordKeys", request);
		JsonNode keys = answer.path("keys");
		JsonNode modified = answer.path("modifiedOn");
		Map<String, Long> records = new LinkedHashMap<>();
		for (int i = 0; i < keys.size(); i++) {
			records.put(keys.get(i).asText(), modified.has(i) ? modified.get(i).asLong() : 0L);
		}
		return records;
	}

	/**
	 * Downloads the signed-in account's own records of the project (a zip of the survey and their XML, as Collect Earth's
	 * "Export data to XML (ZIP)" writes it) to a temporary file the caller deletes.
	 */
	public OwnRecords downloadOwnRecords(Destination destination) throws IOException {
		return downloadOwnRecords(destination, null);
	}

	/** How many records {@link #downloadOwnRecords(Destination, Collection)} names (the server's MY_RECORDS_KEYS) */
	static final int OWN_RECORDS_KEYS = 200;

	/**
	 * {@link #downloadOwnRecords(Destination)}, only the records of those keys (all of them when null, or more than
	 * {@link #OWN_RECORDS_KEYS}).
	 */
	public OwnRecords downloadOwnRecords(Destination destination, java.util.Collection<String> keys) throws IOException {
		StringBuilder url = new StringBuilder(destination.projectUrl("/my-records.zip"));
		if (keys != null && !keys.isEmpty() && keys.size() <= OWN_RECORDS_KEYS) {
			char separator = '?';
			for (String key : keys) {
				url.append(separator).append("key=").append(java.net.URLEncoder.encode(key, java.nio.charset.StandardCharsets.UTF_8.name()));
				separator = '&';
			}
		}
		HttpGet request = new HttpGet(url.toString());
		prepareWith(request, destination.getToken());
		try (CloseableHttpResponse response = client().execute(request)) {
			int status = response.getStatusLine().getStatusCode();
			if (!isSuccess(status)) {
				throw errorFor("downloadOwnRecords", status, response);
			}
			HttpEntity entity = response.getEntity();
			if (entity == null) {
				throw new IOException("The cloud server returned no records file");
			}
			org.apache.http.Header header = response.getFirstHeader("X-Records");
			int count = -1;
			try {
				count = header == null ? -1 : Integer.parseInt(header.getValue().trim());
			} catch (NumberFormatException e) {
				// an older server's answer: the count is not known
			}
			File tempFile = File.createTempFile("ce-cloud-own-records-", ".zip");
			try (java.io.OutputStream out = Files.newOutputStream(tempFile.toPath())) {
				entity.writeTo(out);
			}
			return new OwnRecords(tempFile, count);
		}
	}

	/** One CSV file assigned to the logged-in operator. */
	public static class AssignmentInfo {
		private final String csvFileId;
		private final String filename;
		private final String checksum;
		private final String downloadPath;
		private final int plotCount;
		/**
		 * For a learning set's file in a new attempt: when the attempt started. The interpreter's records of its plots
		 * saved before are deleted when the file is taken, so they assess the plots afresh. Null otherwise.
		 */
		private final Date freshSince;
		/** A training set's file: its kind (calibration, learning); null for the person's plots */
		private String trainingKind;

		public AssignmentInfo(String csvFileId, String filename, String checksum, String downloadPath, int plotCount) {
			this(csvFileId, filename, checksum, downloadPath, plotCount, null);
		}

		public AssignmentInfo(String csvFileId, String filename, String checksum, String downloadPath, int plotCount, Date freshSince) {
			this.csvFileId = csvFileId;
			this.filename = filename;
			this.checksum = checksum;
			this.downloadPath = downloadPath;
			this.plotCount = plotCount;
			this.freshSince = freshSince;
		}

		/** A training set's file: its kind, or null */
		public String getTrainingKind() {
			return trainingKind;
		}

		AssignmentInfo training(String kind) {
			this.trainingKind = kind;
			return this;
		}

		public Date getFreshSince() {
			return freshSince;
		}

		public String getCsvFileId() {
			return csvFileId;
		}

		public String getFilename() {
			return filename;
		}

		public String getChecksum() {
			return checksum;
		}

		public String getDownloadPath() {
			return downloadPath;
		}

		public int getPlotCount() {
			return plotCount;
		}
	}

	/**
	 * When a learning set's attempt started, by this computer's clock: the server's time less the difference between the
	 * server's clock and this one (records are compared with it by their local save time).
	 */
	static Date freshSinceHere(long freshSince, JsonNode serverTime, long localNow) {
		if (serverTime == null || !serverTime.isNumber()) {
			return new Date(freshSince);
		}
		return new Date(freshSince + (localNow - serverTime.asLong()));
	}

	/**
	 * The training feedback of one plot just submitted (GET /training/feedback): for a learning set the operator takes
	 * part in, their answers next to the golden ones ({@code status} scored), pending, or none.
	 */
	public JsonNode getTrainingFeedback(String recordKey) throws IOException {
		HttpGet request = new HttpGet(baseUrl() + "/v1/projects/" + projectId() + "/training/feedback?key="
				+ java.net.URLEncoder.encode(recordKey, java.nio.charset.StandardCharsets.UTF_8.name()));
		prepare(request);
		return executeForJson("getTrainingFeedback", request);
	}

	/**
	 * A plot's answers in the earlier periods of a repeat survey (docs/plans/2026-11-11-repeat-survey.md), with the
	 * questions' labels, their answers' names, and what the form's header shows: {@code {periods: [{label, savedAt,
	 * answers}], labels, options, label, header}}; no periods for a project that repeats no survey.
	 */
	public JsonNode getPlotPeriods(String placemarkId) throws IOException {
		HttpGet request = new HttpGet(baseUrl() + "/v1/projects/" + projectId() + "/periods/plots/"
				+ java.net.URLEncoder.encode(placemarkId, java.nio.charset.StandardCharsets.UTF_8.name()).replace("+", "%20"));
		prepare(request);
		return executeForJson("getPlotPeriods", request);
	}

	/**
	 * The plot layout of the project file on the server (GET /plot-layout), as the coordinator set it on the dashboard:
	 * the settings of Settings > Plot it has, by property name.
	 */
	public Map<String, String> getPlotLayout() throws IOException {
		return getProjectSettings("getPlotLayout", "plot-layout", "layout");
	}

	/**
	 * The imagery windows of the project file on the server (GET /imagery), as the coordinator set them on the dashboard:
	 * the settings of Settings > Imagery it has but the Planet key, by property name.
	 */
	public Map<String, String> getImagery() throws IOException {
		return getProjectSettings("getImagery", "imagery", "imagery");
	}

	private Map<String, String> getProjectSettings(String what, String path, String field) throws IOException {
		HttpGet request = new HttpGet(baseUrl() + "/v1/projects/" + projectId() + "/" + path);
		prepare(request);
		JsonNode values = executeForJson(what, request).get(field);
		Map<String, String> result = new LinkedHashMap<>();
		if (values != null && values.isObject()) {
			values.fields().forEachRemaining(entry -> result.put(entry.getKey(), entry.getValue().asText()));
		}
		return result;
	}

	/**
	 * What my-assignment answers: the files assigned to the operator (the training sets they take part in among them),
	 * and the training that is over (docs/plans/2026-11-17-training-the-team.md).
	 */
	public static class MyAssignment {
		private final List<AssignmentInfo> assignments;
		private final List<String> finishedFiles;
		private final List<String> finishedPlots;

		public MyAssignment(List<AssignmentInfo> assignments, List<String> finishedFiles, List<String> finishedPlots) {
			this.assignments = assignments;
			this.finishedFiles = finishedFiles;
			this.finishedPlots = finishedPlots;
		}

		public List<AssignmentInfo> getAssignments() {
			return assignments;
		}

		/** The files of the finished training sets the operator took part in, as they were served */
		public List<String> getFinishedFiles() {
			return finishedFiles;
		}

		/**
		 * The plot ids (record keys, a plot of several keys with them joined by commas) of the training that is over,
		 * finished or deleted: their records are no use any more, here or on the server
		 */
		public List<String> getFinishedPlots() {
			return finishedPlots;
		}
	}

	/** Lists the CSV files assigned to the logged-in operator for the configured project. */
	public List<AssignmentInfo> getMyAssignments() throws IOException {
		return getMyAssignment().getAssignments();
	}

	/** {@link #getMyAssignments()} with the training that is over */
	public MyAssignment getMyAssignment() throws IOException {
		HttpGet request = new HttpGet(baseUrl() + "/v1/projects/" + projectId() + "/my-assignment");
		prepare(request);
		return readMyAssignment(executeForJson("getMyAssignments", request), System.currentTimeMillis());
	}

	static MyAssignment readMyAssignment(JsonNode response, long localNow) {
		List<AssignmentInfo> result = new ArrayList<>();
		JsonNode assignments = response.get("assignments");
		if (assignments != null && assignments.isArray()) {
			for (JsonNode a : assignments) {
				JsonNode training = a.get("training");
				boolean isTraining = training != null && training.isObject();
				JsonNode fresh = isTraining ? training.get("freshSince") : null;
				JsonNode serverTime = isTraining ? training.get("serverTime") : null;
				result.add(new AssignmentInfo(textOrNull(a, "csvFileId"), textOrNull(a, "filename"),
						textOrNull(a, "checksum"), textOrNull(a, "downloadPath"),
						a.has("plotCount") ? a.get("plotCount").asInt() : 0,
						fresh != null && fresh.isNumber() ? freshSinceHere(fresh.asLong(), serverTime, localNow) : null)
								.training(isTraining ? kindOf(training) : null));
			}
		}
		// Absent from a server older than the training the team has (docs/plans/2026-11-17-training-the-team.md)
		JsonNode finished = response.get("finishedTraining");
		return new MyAssignment(result, texts(finished == null ? null : finished.get("files")),
				texts(finished == null ? null : finished.get("plots")));
	}

	private static String kindOf(JsonNode training) {
		String kind = textOrNull(training, "kind"); //$NON-NLS-1$
		return kind == null || kind.isEmpty() ? "training" : kind; //$NON-NLS-1$
	}

	private static List<String> texts(JsonNode array) {
		List<String> list = new ArrayList<>();
		if (array != null && array.isArray()) {
			for (JsonNode item : array) {
				if (item.isTextual() && !item.asText().isEmpty()) {
					list.add(item.asText());
				}
			}
		}
		return list;
	}

	/** What the server says of the person's plots (GET my-plots): asked every few minutes */
	public static final class MyPlotsInfo {
		private final String version;
		private final int plots;
		private final int keyColumns;
		private final String downloadPath;
		private final List<String> leftOut;
		private final int unreadable;

		public MyPlotsInfo(String version, int plots, int keyColumns, String downloadPath, List<String> leftOut, int unreadable) {
			this.version = version;
			this.plots = plots;
			this.keyColumns = keyColumns;
			this.downloadPath = downloadPath;
			this.leftOut = leftOut;
			this.unreadable = unreadable;
		}

		/** Changes whenever what the person gets changes */
		public String getVersion() {
			return version;
		}

		public int getPlots() {
			return plots;
		}

		/** How many of the first columns are the plot's keys (the survey's keys, the round with them) */
		public int getKeyColumns() {
			return keyColumns;
		}

		/** The file of this version, relative to the server */
		public String getDownloadPath() {
			return downloadPath;
		}

		/** The plot files left out (their columns are not the others'), by name */
		public List<String> getLeftOut() {
			return leftOut;
		}

		/** Rows left out as Collect Earth cannot read their coordinates */
		public int getUnreadable() {
			return unreadable;
		}
	}

	/**
	 * The person's plots in the project (GET my-plots, docs/plans/2026-11-16-plots-from-the-server.md). An older server,
	 * which has no such route, answers 404, as it does to someone who is not in the project.
	 */
	public MyPlotsInfo myPlots(Destination destination) throws IOException {
		HttpGet request = new HttpGet(destination.projectUrl("/my-plots"));
		prepareWith(request, destination.getToken());
		JsonNode answer = executeForJson("myPlots", request);
		List<String> leftOut = new ArrayList<>();
		for (JsonNode file : answer.path("leftOut")) {
			leftOut.add(file.path("filename").asText());
		}
		return new MyPlotsInfo(answer.path("version").asText(""), answer.path("plots").asInt(0), Math.max(1, answer.path("keyColumns").asInt(1)),
				answer.path("downloadPath").asText(""), leftOut, answer.path("unreadable").asInt(0));
	}

	/** The person's plots as downloaded: a temporary file the caller deletes */
	public static final class MyPlotsFile {
		private final File file;
		private final boolean plotFileColumn;

		public MyPlotsFile(File file, boolean plotFileColumn) {
			this.file = file;
			this.plotFileColumn = plotFileColumn;
		}

		public File getFile() {
			return file;
		}

		/** The last column is each row's plot file (asked for), not one of the survey's */
		public boolean hasPlotFileColumn() {
			return plotFileColumn;
		}
	}

	/**
	 * Downloads the person's plots of a version (MyPlotsInfo.getDownloadPath), with each row's plot file in a last
	 * column, checked against the checksum the server sends. A 409 says it changed since it was listed.
	 */
	public MyPlotsFile downloadMyPlots(Destination destination, String downloadPath) throws IOException {
		String path = downloadPath + (downloadPath.contains("?") ? "&" : "?") + "plotFile=1";
		HttpGet request = new HttpGet(normalize(destination.getBaseUrl()) + path);
		prepareWith(request, destination.getToken());
		File temp = File.createTempFile("ce-my-plots-", ".csv");
		boolean done = false;
		try (CloseableHttpResponse response = client().execute(request)) {
			int status = response.getStatusLine().getStatusCode();
			if (!isSuccess(status)) {
				throw errorFor("downloadMyPlots", status, response);
			}
			HttpEntity entity = response.getEntity();
			if (entity != null) {
				try (java.io.OutputStream out = Files.newOutputStream(temp.toPath())) {
					entity.writeTo(out);
				}
			}
			org.apache.http.Header checksum = response.getFirstHeader("X-Checksum-Sha256");
			if (checksum != null) {
				String actual;
				try (java.io.InputStream in = Files.newInputStream(temp.toPath())) {
					actual = org.apache.commons.codec.digest.DigestUtils.sha256Hex(in);
				}
				if (!checksum.getValue().trim().equalsIgnoreCase(actual)) {
					throw new IOException("Checksum mismatch for the downloaded plots");
				}
			}
			org.apache.http.Header column = response.getFirstHeader("X-Plot-File-Column");
			done = true;
			return new MyPlotsFile(temp, column != null && "1".equals(column.getValue().trim()));
		} finally {
			if (!done) {
				Files.deleteIfExists(temp.toPath());
			}
		}
	}

	/**
	 * Downloads an assigned CSV into {@code targetFolder}, verifying its sha256
	 * checksum against the value the server advertised. Returns the local file.
	 */
	public File downloadAssignedCsv(AssignmentInfo assignment, File targetFolder) throws IOException {
		if (!targetFolder.exists() && !targetFolder.mkdirs()) {
			throw new IOException("Could not create the assignments folder " + targetFolder.getAbsolutePath());
		}
		// The filename comes from the server and must never be trusted to build a local
		// path: strip any directory components and confirm the resolved file stays inside
		// targetFolder, so a hostile/compromised server cannot write outside it (path traversal).
		String safeName = fileNameHere(targetFolder, new File(assignment.getFilename() == null ? "" : assignment.getFilename()).getName());
		if (safeName.isEmpty() || safeName.equals(".") || safeName.equals("..")) {
			throw new IOException("Invalid CSV filename received from the cloud server: " + assignment.getFilename());
		}
		File dest = new File(targetFolder, safeName).getCanonicalFile();
		if (!dest.toPath().startsWith(targetFolder.getCanonicalFile().toPath())) {
			throw new IOException("Refusing to write a CSV outside the assignments folder: " + assignment.getFilename());
		}
		// Written aside and moved in once verified: the plots file in use is never left half-written
		java.nio.file.Path temp = Files.createTempFile(targetFolder.toPath(), safeName, ".part");
		try {
			HttpGet request = new HttpGet(baseUrl() + assignment.getDownloadPath());
			prepare(request);
			try (CloseableHttpResponse response = client().execute(request)) {
				int status = response.getStatusLine().getStatusCode();
				if (!isSuccess(status)) {
					throw errorFor("downloadAssignedCsv", status, response);
				}
				HttpEntity entity = response.getEntity();
				if (entity == null) {
					throw new IOException("The cloud server returned an empty CSV for " + assignment.getFilename());
				}
				try (java.io.OutputStream out = Files.newOutputStream(temp)) {
					entity.writeTo(out);
				}
			}
			if (assignment.getChecksum() != null && !assignment.getChecksum().isEmpty()) {
				String actual;
				try (java.io.InputStream in = Files.newInputStream(temp)) {
					actual = org.apache.commons.codec.digest.DigestUtils.sha256Hex(in);
				}
				if (!assignment.getChecksum().equalsIgnoreCase(actual)) {
					throw new IOException("Checksum mismatch for the downloaded CSV " + assignment.getFilename());
				}
			}
			try {
				Files.move(temp, dest.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
			} catch (AtomicMoveNotSupportedException e) {
				Files.move(temp, dest.toPath(), StandardCopyOption.REPLACE_EXISTING);
			}
		} finally {
			Files.deleteIfExists(temp);
		}
		return dest;
	}

	/**
	 * The name as the file system here takes it: one whose characters it cannot write (a training set's "Calibration –
	 * set.csv" where the file names are not UTF-8, a Linux in the POSIX locale) has those replaced by "_".
	 */
	static String fileNameHere(File folder, String name) {
		try {
			folder.toPath().resolve(name + ".part");
			return name;
		} catch (java.nio.file.InvalidPathException e) {
			return name.replaceAll("[^\\x20-\\x7E]", "_");
		}
	}

	/** Executes a request expecting a JSON object body, throwing an informative IOException on failure. */
	private JsonNode executeForJson(String operation, HttpRequestBase request) throws IOException {
		try (CloseableHttpResponse response = client().execute(request)) {
			int status = response.getStatusLine().getStatusCode();
			HttpEntity entity = response.getEntity();
			String responseBody = entity == null ? "" : EntityUtils.toString(entity, StandardCharsets.UTF_8);
			if (!isSuccess(status)) {
				throw errorFor(operation, status, responseBody);
			}
			return objectMapper.readTree(responseBody.isEmpty() ? "{}" : responseBody);
		}
	}

	/**
	 * The User-Agent for a version name: "CollectEarth/&lt;version&gt; cloud-sync", with the
	 * version's whitespace removed so that it is one token, and "unknown" when there is
	 * no version.
	 */
	static String userAgentFor(String versionName) {
		String version = versionName == null ? "" : versionName.replaceAll("\\s+", "");
		if (version.isEmpty()) {
			version = UNKNOWN_VERSION;
		}
		return "CollectEarth/" + version + " cloud-sync";
	}

	private static String installedVersion() {
		try {
			return UpdateIniUtils.getVersionNameInstalled();
		} catch (RuntimeException e) {
			return null;
		}
	}

	private void prepare(HttpRequestBase request) {
		prepareWith(request, token());
	}

	private void prepareWith(HttpRequestBase request, String bearer) {
		timeouts(request);
		request.setHeader("Authorization", "Bearer " + bearer);
		request.setHeader("User-Agent", USER_AGENT);
	}

	private void prepareNoAuth(HttpRequestBase request) {
		timeouts(request);
		request.setHeader("User-Agent", USER_AGENT);
	}

	private void timeouts(HttpRequestBase request) {
		request.setConfig(RequestConfig.custom()
				.setConnectTimeout(TIMEOUT_MS)
				.setSocketTimeout(TIMEOUT_MS)
				.setConnectionRequestTimeout(TIMEOUT_MS)
				.build());
	}

	private static String normalize(String url) {
		if (url == null) {
			return "";
		}
		String trimmed = url.trim();
		while (trimmed.endsWith("/")) {
			trimmed = trimmed.substring(0, trimmed.length() - 1);
		}
		return trimmed;
	}

	private StringEntity jsonEntity(String json) {
		return new StringEntity(json, ContentType.APPLICATION_JSON);
	}

	private IOException errorFor(String operation, int status, CloseableHttpResponse response) {
		String body = "";
		try {
			HttpEntity entity = response.getEntity();
			if (entity != null) {
				body = EntityUtils.toString(entity, StandardCharsets.UTF_8);
			}
		} catch (IOException ignored) {
			// best effort: the status alone is still informative
		}
		return errorFor(operation, status, body);
	}

	private IOException errorFor(String operation, int status, String body) {
		String excerpt = body == null ? "" : body.substring(0, Math.min(body.length(), ERROR_BODY_EXCERPT));
		return new CloudApiException(operation + " failed with HTTP " + status + ": " + excerpt, status, errorCodeOf(body));
	}

	/** The {@code error} of a JSON answer, or null when the body is no JSON object with one */
	private String errorCodeOf(String body) {
		if (body == null || body.isEmpty()) {
			return null;
		}
		try {
			JsonNode error = objectMapper.readTree(body).get("error");
			return error != null && error.isTextual() ? error.asText() : null;
		} catch (IOException | RuntimeException e) {
			return null;
		}
	}

	private static boolean isSuccess(int statusCode) {
		return statusCode >= 200 && statusCode < 300;
	}

	private CloseableHttpClient client() {
		CloseableHttpClient local = httpClient;
		if (local == null) {
			synchronized (this) {
				local = httpClient;
				if (local == null) {
					local = HttpClients.createDefault();
					httpClient = local;
				}
			}
		}
		return local;
	}

	private String baseUrl() {
		String url = localPropertiesService.getCloudSyncUrl();
		if (url == null) {
			return "";
		}
		url = url.trim();
		while (url.endsWith("/")) {
			url = url.substring(0, url.length() - 1);
		}
		return url;
	}

	private String projectId() {
		return localPropertiesService.getCloudProjectId();
	}

	private String token() {
		return localPropertiesService.getCloudSyncToken();
	}

	@PreDestroy
	public void close() {
		CloseableHttpClient local = httpClient;
		if (local != null) {
			try {
				local.close();
			} catch (IOException e) {
				logger.debug("Error closing cloud sync HTTP client: {}", e.getMessage());
			}
			httpClient = null;
		}
	}
}
