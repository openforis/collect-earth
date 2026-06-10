package org.openforis.collect.earth.app.service.sync;

import static org.openforis.collect.earth.app.EarthConstants.ACTIVELY_SAVED_PARAMETER;
import static org.openforis.collect.earth.app.EarthConstants.OPERATOR_PARAMETER;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.core.model.PlacemarkLoadResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.google.gson.Gson;

@Component
public class PlotSyncJournalService {

	private static final String SAVE_PLACEMARK_OPERATION = "SAVE_PLACEMARK";
	private static final String PARTIAL_STATUS = "partial";
	private static final String COMPLETED_STATUS = "completed";

	private final Logger logger = LoggerFactory.getLogger(PlotSyncJournalService.class);
	private final Gson gson = new Gson();
	private boolean initialized;

	@Autowired
	private LocalPropertiesService localPropertiesService;

	public void enqueuePlacemarkSave(String plotKey, Map<String, String> collectedData, PlacemarkLoadResult result) {
		if (!localPropertiesService.isSyncEnabled()) {
			return;
		}
		try {
			initialize();
			PlotSyncEvent event = createPlacemarkSaveEvent(plotKey, collectedData, result);
			insertEvent(event);
		} catch (Exception e) {
			logger.warn("The plot sync event could not be queued for plot " + plotKey, e);
		}
	}

	private PlotSyncEvent createPlacemarkSaveEvent(String plotKey, Map<String, String> collectedData,
			PlacemarkLoadResult result) {
		PlotSyncEvent event = new PlotSyncEvent();
		event.setEventId(UUID.randomUUID().toString());
		event.setProjectId(resolveProjectId());
		event.setClientId(resolveClientId());
		event.setPlotKey(plotKey);
		event.setOperation(SAVE_PLACEMARK_OPERATION);
		event.setBaseRevision(0);
		event.setPayload(createPayload(collectedData, result));
		event.setCreatedAt(new Date());
		return event;
	}

	private Map<String, String> createPayload(Map<String, String> collectedData, PlacemarkLoadResult result) {
		Map<String, String> payload = new LinkedHashMap<String, String>();
		payload.put("status", isCompleted(collectedData, result) ? COMPLETED_STATUS : PARTIAL_STATUS);
		payload.put("completedBy", localPropertiesService.getOperator());
		payload.put("operator", localPropertiesService.getOperator());
		payload.put("validData", Boolean.toString(result.isValidData()));
		payload.put("activelySaved", Boolean.toString(result.isActivelySaved()));
		payload.put("values", gson.toJson(collectedData));
		return payload;
	}

	private boolean isCompleted(Map<String, String> collectedData, PlacemarkLoadResult result) {
		return result.isActivelySaved() || Boolean.TRUE.toString().equals(collectedData.get(ACTIVELY_SAVED_PARAMETER));
	}

	private synchronized void initialize() throws Exception {
		if (initialized) {
			return;
		}
		Class.forName("org.sqlite.JDBC");
		try (Connection connection = openConnection();
				Statement statement = connection.createStatement()) {
			statement.execute("CREATE TABLE IF NOT EXISTS ce_sync_event ("
					+ "event_id TEXT PRIMARY KEY, "
					+ "project_id TEXT NOT NULL, "
					+ "client_id TEXT NOT NULL, "
					+ "plot_key TEXT NOT NULL, "
					+ "operation TEXT NOT NULL, "
					+ "base_revision INTEGER NOT NULL DEFAULT 0, "
					+ "payload_json TEXT NOT NULL, "
					+ "created_at INTEGER NOT NULL, "
					+ "attempt_count INTEGER NOT NULL DEFAULT 0, "
					+ "last_error TEXT, "
					+ "status TEXT NOT NULL DEFAULT 'pending'"
					+ ")");
			statement.execute("CREATE INDEX IF NOT EXISTS idx_ce_sync_event_status_created "
					+ "ON ce_sync_event(status, created_at)");
		}
		initialized = true;
	}

	private void insertEvent(PlotSyncEvent event) throws Exception {
		String sql = "INSERT INTO ce_sync_event "
				+ "(event_id, project_id, client_id, plot_key, operation, base_revision, payload_json, created_at, status) "
				+ "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')";
		try (Connection connection = openConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setString(1, event.getEventId());
			statement.setString(2, event.getProjectId());
			statement.setString(3, event.getClientId());
			statement.setString(4, event.getPlotKey());
			statement.setString(5, event.getOperation());
			statement.setInt(6, event.getBaseRevision());
			statement.setString(7, gson.toJson(event.getPayload()));
			statement.setLong(8, event.getCreatedAt().getTime());
			statement.executeUpdate();
		}
	}

	private Connection openConnection() throws Exception {
		return DriverManager.getConnection("jdbc:sqlite:" + EarthConstants.COLLECT_EARTH_SYNC_DATABASE_SQLITE_DB);
	}

	private String resolveProjectId() {
		String projectId = localPropertiesService.getSyncProjectId();
		if (StringUtils.isNotBlank(projectId)) {
			return projectId;
		}
		String surveyName = localPropertiesService.getValue(EarthProperty.SURVEY_NAME);
		if (StringUtils.isBlank(surveyName)) {
			return "collect-earth-project";
		}
		return surveyName.replaceAll("[^A-Za-z0-9_.-]", "_");
	}

	private String resolveClientId() {
		String clientId = localPropertiesService.getSyncClientId();
		if (StringUtils.isNotBlank(clientId)) {
			return clientId;
		}
		String operator = localPropertiesService.getOperator();
		if (StringUtils.isNotBlank(operator)) {
			return operator.replaceAll("[^A-Za-z0-9_.-]", "_");
		}
		return "collect-earth-client";
	}
}
