package org.openforis.collect.earth.app.service.cloud;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.dbcp2.BasicDataSource;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

/**
 * Durable local queue of records pending upload to a Collect Earth cloud project.
 *
 * The queue lives in the same database as the Collect records and is accessed
 * through the shared Spring {@code dataSource} bean: the SQLite pool is configured
 * with a single connection (SQLite is single-writer), so opening a second pool to
 * the same file would cause SQLITE_BUSY errors. All SQL is kept ANSI-portable so
 * the queue also works when the user runs PostgreSQL with cloud sync enabled.
 *
 * Every item belongs to a survey and to a cloud project (several projects of this
 * computer can be cloud projects, and two of them could share a survey): only the
 * items of the project open are taken, counted and marked, the others wait until
 * their project is opened again.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
@Component
public class CloudSyncQueueDao {

	public static final String STATUS_PENDING = "PENDING"; //$NON-NLS-1$
	public static final String STATUS_FAILED = "FAILED"; //$NON-NLS-1$
	public static final String STATUS_SYNCED = "SYNCED"; //$NON-NLS-1$
	public static final String STATUS_CONFLICT = "CONFLICT"; //$NON-NLS-1$

	private static final String TABLE = "ce_cloud_sync_queue"; //$NON-NLS-1$
	/** Sentinel record_key used to persist the reconciliation watermark per survey and cloud project. */
	private static final String WATERMARK_KEY = "__reconciliation_watermark__"; //$NON-NLS-1$
	private static final String COLUMNS = "record_key, survey_uri, operator, local_modified_on, sync_status, attempts, next_attempt_on, last_error, synced_on, deleted"; //$NON-NLS-1$
	private static final String SCOPE = " AND survey_uri = ? AND cloud_project_id = ?"; //$NON-NLS-1$

	private final Logger logger = LoggerFactory.getLogger(CloudSyncQueueDao.class);

	@Autowired
	private BasicDataSource dataSource;
	/** The cloud project of the versions before, which the items queued then belong to */
	@Autowired
	private LocalPropertiesService properties;

	private JdbcTemplate jdbcTemplate;
	private volatile boolean tableEnsured = false;

	/** Item queued for upload (or tombstone upload when {@link #isDeleted()}). */
	public static class QueueItem {
		private final String recordKey;
		private final String surveyUri;
		private final String cloudProjectId;
		private final String operator;
		private final Date localModifiedOn;
		private final int attempts;
		private final boolean deleted;

		public QueueItem(String recordKey, String surveyUri, String cloudProjectId, String operator, Date localModifiedOn, int attempts,
				boolean deleted) {
			this.recordKey = recordKey;
			this.surveyUri = surveyUri;
			this.cloudProjectId = cloudProjectId;
			this.operator = operator;
			this.localModifiedOn = localModifiedOn;
			this.attempts = attempts;
			this.deleted = deleted;
		}

		public String getRecordKey() {
			return recordKey;
		}

		public String getSurveyUri() {
			return surveyUri;
		}

		public String getCloudProjectId() {
			return cloudProjectId;
		}

		public String getOperator() {
			return operator;
		}

		public Date getLocalModifiedOn() {
			return localModifiedOn;
		}

		public int getAttempts() {
			return attempts;
		}

		public boolean isDeleted() {
			return deleted;
		}
	}

	/** Snapshot of the queue state, used by the sync status dialog. */
	public static class QueueStatus {
		private final int pending;
		private final int failed;
		private final int synced;
		private final Date lastSyncedOn;
		private final String lastError;

		public QueueStatus(int pending, int failed, int synced, Date lastSyncedOn, String lastError) {
			this.pending = pending;
			this.failed = failed;
			this.synced = synced;
			this.lastSyncedOn = lastSyncedOn;
			this.lastError = lastError;
		}

		public int getPending() {
			return pending;
		}

		public int getFailed() {
			return failed;
		}

		public int getSynced() {
			return synced;
		}

		public Date getLastSyncedOn() {
			return lastSyncedOn;
		}

		public String getLastError() {
			return lastError;
		}
	}

	private static final RowMapper<QueueItem> ITEM_MAPPER = new RowMapper<QueueItem>() {
		@Override
		public QueueItem mapRow(ResultSet rs, int rowNum) throws SQLException {
			return new QueueItem(rs.getString("record_key"), rs.getString("survey_uri"), rs.getString("cloud_project_id"), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					rs.getString("operator"), rs.getTimestamp("local_modified_on"), rs.getInt("attempts"), rs.getInt("deleted") != 0); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		}
	};

	private static String createTable(String name) {
		return "CREATE TABLE IF NOT EXISTS " + name + " (" //$NON-NLS-1$ //$NON-NLS-2$
				+ "record_key VARCHAR(2048) NOT NULL, " //$NON-NLS-1$
				+ "survey_uri VARCHAR(255) NOT NULL, " //$NON-NLS-1$
				+ "operator VARCHAR(255), " //$NON-NLS-1$
				+ "local_modified_on TIMESTAMP, " //$NON-NLS-1$
				+ "sync_status VARCHAR(20) NOT NULL, " //$NON-NLS-1$
				+ "attempts INTEGER DEFAULT 0 NOT NULL, " //$NON-NLS-1$
				+ "next_attempt_on TIMESTAMP, " //$NON-NLS-1$
				+ "last_error VARCHAR(2048), " //$NON-NLS-1$
				+ "synced_on TIMESTAMP, " //$NON-NLS-1$
				+ "deleted INTEGER DEFAULT 0 NOT NULL, " //$NON-NLS-1$
				+ "cloud_project_id VARCHAR(255) DEFAULT '' NOT NULL, " //$NON-NLS-1$
				+ "PRIMARY KEY (record_key, survey_uri, cloud_project_id))"; //$NON-NLS-1$
	}

	private synchronized JdbcTemplate jdbc() {
		if (jdbcTemplate == null) {
			jdbcTemplate = new JdbcTemplate(dataSource);
		}
		if (!tableEnsured) {
			jdbcTemplate.execute(createTable(TABLE));
			try {
				jdbcTemplate.queryForList("SELECT cloud_project_id FROM " + TABLE + " WHERE 1 = 0"); //$NON-NLS-1$ //$NON-NLS-2$
			} catch (DataAccessException before) {
				addCloudProject();
			}
			tableEnsured = true;
		}
		return jdbcTemplate;
	}

	/**
	 * The table of the versions with a single cloud project gets the cloud project in its key, its items given to that
	 * project: copied into a new table in one transaction, so a failure leaves the old one as it was.
	 */
	private void addCloudProject() {
		String legacyProject = properties == null ? "" : StringUtils.trimToEmpty(properties.getValue(EarthProperty.CLOUD_PROJECT_ID)); //$NON-NLS-1$
		jdbcTemplate.execute((ConnectionCallback<Void>) connection -> {
			boolean autoCommit = connection.getAutoCommit();
			connection.setAutoCommit(false);
			try (Statement statement = connection.createStatement()) {
				statement.execute(createTable(TABLE + "_new")); //$NON-NLS-1$
				try (java.sql.PreparedStatement copy = connection.prepareStatement("INSERT INTO " + TABLE + "_new (" + COLUMNS //$NON-NLS-1$ //$NON-NLS-2$
						+ ", cloud_project_id) SELECT " + COLUMNS + ", ? FROM " + TABLE)) { //$NON-NLS-1$ //$NON-NLS-2$
					copy.setString(1, legacyProject);
					copy.executeUpdate();
				}
				statement.execute("DROP TABLE " + TABLE); //$NON-NLS-1$
				statement.execute("ALTER TABLE " + TABLE + "_new RENAME TO " + TABLE); //$NON-NLS-1$ //$NON-NLS-2$
				connection.commit();
			} catch (SQLException | RuntimeException e) {
				rollback(connection);
				throw e;
			} finally {
				connection.setAutoCommit(autoCommit);
			}
			logger.info("The cloud sync queue now keeps the cloud project of each item; the items of before are {}'s", legacyProject); //$NON-NLS-1$
			return null;
		});
	}

	private void rollback(Connection connection) {
		try {
			connection.rollback();
		} catch (SQLException e) {
			logger.warn("The cloud sync queue's change could not be rolled back: {}", e.getMessage()); //$NON-NLS-1$
		}
	}

	/**
	 * Adds or refreshes a queue entry for a locally saved (or deleted) record of a cloud project. If a
	 * row already exists it is reset to PENDING with a new modification time so the
	 * next sync cycle picks it up again.
	 */
	public synchronized void enqueue(String recordKey, String surveyUri, String cloudProjectId, String operator, Date localModifiedOn,
			boolean deleted) {
		Timestamp modifiedOn = toTimestamp(localModifiedOn);
		String project = StringUtils.trimToEmpty(cloudProjectId);
		int updated = jdbc().update(
				"UPDATE " + TABLE //$NON-NLS-1$
						+ " SET sync_status = ?, operator = ?, local_modified_on = ?, deleted = ?, attempts = 0, next_attempt_on = NULL, last_error = NULL" //$NON-NLS-1$
						+ " WHERE record_key = ?" + SCOPE, //$NON-NLS-1$
				STATUS_PENDING, operator, modifiedOn, deleted ? 1 : 0, recordKey, surveyUri, project);
		if (updated == 0) {
			jdbc().update(
					"INSERT INTO " + TABLE //$NON-NLS-1$
							+ " (record_key, survey_uri, cloud_project_id, operator, local_modified_on, sync_status, attempts, deleted) VALUES (?,?,?,?,?,?,0,?)", //$NON-NLS-1$
					recordKey, surveyUri, project, operator, modifiedOn, STATUS_PENDING, deleted ? 1 : 0);
		}
	}

	/**
	 * Returns up to {@code limit} items of the survey and cloud project due for upload (PENDING, or FAILED past their
	 * backoff): never another project's, which another server or survey would take for someone else's or drop.
	 */
	public synchronized List<QueueItem> takeDue(int limit, Date now, String surveyUri, String cloudProjectId) {
		return jdbc().query(
				"SELECT record_key, survey_uri, cloud_project_id, operator, local_modified_on, attempts, deleted FROM " + TABLE //$NON-NLS-1$
						+ " WHERE record_key <> ?" + SCOPE + " AND sync_status IN ('" + STATUS_PENDING + "','" + STATUS_FAILED + "')" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
						+ " AND (next_attempt_on IS NULL OR next_attempt_on <= ?) ORDER BY local_modified_on LIMIT " + limit, //$NON-NLS-1$
				ITEM_MAPPER, WATERMARK_KEY, surveyUri, StringUtils.trimToEmpty(cloudProjectId), toTimestamp(now));
	}

	public synchronized void markSynced(QueueItem item, Date syncedOn) {
		jdbc().update(
				"UPDATE " + TABLE + " SET sync_status = ?, synced_on = ?, last_error = NULL WHERE record_key = ?" + SCOPE, //$NON-NLS-1$ //$NON-NLS-2$
				STATUS_SYNCED, toTimestamp(syncedOn), item.getRecordKey(), item.getSurveyUri(), item.getCloudProjectId());
	}

	public synchronized void markFailed(QueueItem item, String error, Date nextAttemptOn) {
		jdbc().update(
				"UPDATE " + TABLE //$NON-NLS-1$
						+ " SET sync_status = ?, attempts = attempts + 1, next_attempt_on = ?, last_error = ? WHERE record_key = ?" + SCOPE, //$NON-NLS-1$
				STATUS_FAILED, toTimestamp(nextAttemptOn), abbreviate(error), item.getRecordKey(), item.getSurveyUri(), item.getCloudProjectId());
	}

	public synchronized void markConflict(QueueItem item, String error) {
		jdbc().update(
				"UPDATE " + TABLE + " SET sync_status = ?, last_error = ? WHERE record_key = ?" + SCOPE, //$NON-NLS-1$ //$NON-NLS-2$
				STATUS_CONFLICT, abbreviate(error), item.getRecordKey(), item.getSurveyUri(), item.getCloudProjectId());
	}

	/** The last time the reconciliation scan ran for the survey and cloud project, or null if never. */
	public synchronized Date getReconciliationWatermark(String surveyUri, String cloudProjectId) {
		List<Timestamp> results = jdbc().query(
				"SELECT synced_on FROM " + TABLE + " WHERE record_key = ?" + SCOPE, //$NON-NLS-1$ //$NON-NLS-2$
				(rs, i) -> rs.getTimestamp(1), WATERMARK_KEY, surveyUri, StringUtils.trimToEmpty(cloudProjectId));
		return results.isEmpty() ? null : results.get(0);
	}

	public synchronized void setReconciliationWatermark(String surveyUri, String cloudProjectId, Date watermark) {
		Timestamp ts = toTimestamp(watermark);
		String project = StringUtils.trimToEmpty(cloudProjectId);
		int updated = jdbc().update(
				"UPDATE " + TABLE + " SET synced_on = ? WHERE record_key = ?" + SCOPE, //$NON-NLS-1$ //$NON-NLS-2$
				ts, WATERMARK_KEY, surveyUri, project);
		if (updated == 0) {
			jdbc().update(
					"INSERT INTO " + TABLE //$NON-NLS-1$
							+ " (record_key, survey_uri, cloud_project_id, sync_status, attempts, deleted, synced_on) VALUES (?,?,?,?,0,0,?)", //$NON-NLS-1$
					WATERMARK_KEY, surveyUri, project, STATUS_SYNCED, ts);
		}
	}

	/** The state of the survey and cloud project's items. */
	public synchronized QueueStatus getStatus(String surveyUri, String cloudProjectId) {
		String project = StringUtils.trimToEmpty(cloudProjectId);
		final Map<String, Integer> counts = new HashMap<>();
		jdbc().query("SELECT sync_status, COUNT(*) FROM " + TABLE + " WHERE record_key <> ?" + SCOPE + " GROUP BY sync_status", //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
				rs -> {
					counts.put(rs.getString(1), rs.getInt(2));
				}, WATERMARK_KEY, surveyUri, project);
		List<Timestamp> lastSynced = jdbc().query(
				"SELECT MAX(synced_on) FROM " + TABLE + " WHERE record_key <> ?" + SCOPE + " AND sync_status = '" + STATUS_SYNCED + "'", //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
				(rs, i) -> rs.getTimestamp(1), WATERMARK_KEY, surveyUri, project);
		List<String> lastErrors = jdbc().query(
				"SELECT last_error FROM " + TABLE + " WHERE record_key <> ?" + SCOPE + " AND last_error IS NOT NULL" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
						+ " ORDER BY next_attempt_on DESC LIMIT 1", //$NON-NLS-1$
				(rs, i) -> rs.getString(1), WATERMARK_KEY, surveyUri, project);
		return new QueueStatus(
				counts.getOrDefault(STATUS_PENDING, 0),
				counts.getOrDefault(STATUS_FAILED, 0) + counts.getOrDefault(STATUS_CONFLICT, 0),
				counts.getOrDefault(STATUS_SYNCED, 0),
				lastSynced.isEmpty() ? null : lastSynced.get(0),
				lastErrors.isEmpty() ? null : lastErrors.get(0));
	}

	/** The sync status of one record of the survey and cloud project, or null when it is not in the queue. */
	public synchronized String getRecordStatus(String recordKey, String surveyUri, String cloudProjectId) {
		List<String> statuses = jdbc().query("SELECT sync_status FROM " + TABLE + " WHERE record_key = ?" + SCOPE, //$NON-NLS-1$ //$NON-NLS-2$
				(rs, i) -> rs.getString(1), recordKey, surveyUri, StringUtils.trimToEmpty(cloudProjectId));
		return statuses.isEmpty() ? null : statuses.get(0);
	}

	/** How many records of a cloud project, of any survey, are still to be sent: pending, failed or in conflict. */
	public synchronized int countUnsent(String cloudProjectId) {
		Integer count = jdbc().queryForObject("SELECT COUNT(*) FROM " + TABLE + " WHERE record_key <> ? AND cloud_project_id = ?" //$NON-NLS-1$ //$NON-NLS-2$
				+ " AND sync_status IN ('" + STATUS_PENDING + "','" + STATUS_FAILED + "','" + STATUS_CONFLICT + "')", //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
				Integer.class, WATERMARK_KEY, StringUtils.trimToEmpty(cloudProjectId));
		return count == null ? 0 : count;
	}

	private static Timestamp toTimestamp(Date date) {
		return date == null ? null : new Timestamp(date.getTime());
	}

	private static String abbreviate(String error) {
		if (error != null && error.length() > 2000) {
			return error.substring(0, 2000);
		}
		return error;
	}
}
