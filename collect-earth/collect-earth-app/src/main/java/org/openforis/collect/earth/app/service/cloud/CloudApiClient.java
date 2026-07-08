package org.openforis.collect.earth.app.service.cloud;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import javax.annotation.PreDestroy;

import org.apache.http.HttpEntity;
import org.apache.http.StatusLine;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.entity.GzipCompressingEntity;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.methods.HttpPut;
import org.apache.http.client.methods.HttpRequestBase;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.util.EntityUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
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
	private static final String USER_AGENT = "CollectEarth-cloud-sync";
	private static final int ERROR_BODY_EXCERPT = 500;

	private final Logger logger = LoggerFactory.getLogger(CloudApiClient.class);
	private final ObjectMapper objectMapper = new ObjectMapper();

	@Autowired
	private LocalPropertiesService localPropertiesService;

	private volatile CloseableHttpClient httpClient;

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

	/** True if the configured project is reachable and the token is accepted. */
	public boolean ping() {
		HttpGet request = new HttpGet(baseUrl() + "/v1/projects/" + projectId());
		prepare(request);
		try (CloseableHttpResponse response = client().execute(request)) {
			return isSuccess(response.getStatusLine().getStatusCode());
		} catch (IOException e) {
			logger.debug("Cloud sync ping failed: {}", e.getMessage());
			return false;
		}
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
		ObjectNode root = objectMapper.createObjectNode();
		ArrayNode records = root.putArray("records");
		for (RecordEnvelope envelope : envelopes) {
			records.add(toJson(envelope));
		}

		HttpPost request = new HttpPost(baseUrl() + "/v1/projects/" + projectId() + "/records:batch");
		prepare(request);
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
		ObjectNode body = objectMapper.createObjectNode();
		body.put("username", username);
		body.put("password", password);
		HttpPost request = new HttpPost(normalize(baseUrl) + "/v1/auth/login");
		prepareNoAuth(request);
		request.setEntity(jsonEntity(body.toString()));
		JsonNode response = executeForJson("login", request);
		return textOrNull(response, "token");
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

	/** Fetches the public preview of an invite (project name, role, validity). No auth. */
	public JoinPreview getJoinPreview(String baseUrl, String inviteToken) throws IOException {
		HttpGet request = new HttpGet(normalize(baseUrl) + "/v1/join/" + inviteToken);
		prepareNoAuth(request);
		JsonNode response = executeForJson("getJoinPreview", request);
		return new JoinPreview(textOrNull(response, "projectId"), textOrNull(response, "projectName"),
				textOrNull(response, "role"), response.has("valid") && response.get("valid").asBoolean());
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

	/** One CSV file assigned to the logged-in operator. */
	public static class AssignmentInfo {
		private final String csvFileId;
		private final String filename;
		private final String checksum;
		private final String downloadPath;
		private final int plotCount;

		public AssignmentInfo(String csvFileId, String filename, String checksum, String downloadPath, int plotCount) {
			this.csvFileId = csvFileId;
			this.filename = filename;
			this.checksum = checksum;
			this.downloadPath = downloadPath;
			this.plotCount = plotCount;
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

	/** Lists the CSV files assigned to the logged-in operator for the configured project. */
	public List<AssignmentInfo> getMyAssignments() throws IOException {
		HttpGet request = new HttpGet(baseUrl() + "/v1/projects/" + projectId() + "/my-assignment");
		prepare(request);
		JsonNode response = executeForJson("getMyAssignments", request);
		List<AssignmentInfo> result = new ArrayList<>();
		JsonNode assignments = response.get("assignments");
		if (assignments != null && assignments.isArray()) {
			for (JsonNode a : assignments) {
				result.add(new AssignmentInfo(textOrNull(a, "csvFileId"), textOrNull(a, "filename"),
						textOrNull(a, "checksum"), textOrNull(a, "downloadPath"),
						a.has("plotCount") ? a.get("plotCount").asInt() : 0));
			}
		}
		return result;
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
		String safeName = new File(assignment.getFilename() == null ? "" : assignment.getFilename()).getName();
		if (safeName.isEmpty() || safeName.equals(".") || safeName.equals("..")) {
			throw new IOException("Invalid CSV filename received from the cloud server: " + assignment.getFilename());
		}
		File dest = new File(targetFolder, safeName).getCanonicalFile();
		if (!dest.toPath().startsWith(targetFolder.getCanonicalFile().toPath())) {
			throw new IOException("Refusing to write a CSV outside the assignments folder: " + assignment.getFilename());
		}
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
			try (java.io.OutputStream out = Files.newOutputStream(dest.toPath())) {
				entity.writeTo(out);
			}
		}
		if (assignment.getChecksum() != null && !assignment.getChecksum().isEmpty()) {
			String actual;
			try (java.io.InputStream in = Files.newInputStream(dest.toPath())) {
				actual = org.apache.commons.codec.digest.DigestUtils.sha256Hex(in);
			}
			if (!assignment.getChecksum().equalsIgnoreCase(actual)) {
				throw new IOException("Checksum mismatch for the downloaded CSV " + assignment.getFilename());
			}
		}
		return dest;
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
		return new IOException(operation + " failed with HTTP " + status + ": " + excerpt);
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
