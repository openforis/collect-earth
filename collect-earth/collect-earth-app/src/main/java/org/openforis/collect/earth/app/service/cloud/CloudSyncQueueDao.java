package org.openforis.collect.earth.app.service.cloud;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.dbcp2.BasicDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
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
 * @author Alfonso Sanchez-Paus Diaz
 */
@Component
public class CloudSyncQueueDao {

	public static final String STATUS_PENDING = "PENDING"; //$NON-NLS-1$
	public static final String STATUS_FAILED = "FAILED"; //$NON-NLS-1$
	public static final String STATUS_SYNCED = "SYNCED"; //$NON-NLS-1$
	public static final String STATUS_CONFLICT = "CONFLICT"; //$NON-NLS-1$

	private static final String TABLE = "ce_cloud_sync_queue"; //$NON-NLS-1$
	/** Sentinel record_key used to persist the reconciliation watermark per survey. */
	private static final String WATERMARK_KEY = "__reconciliation_watermark__"; //$NON-NLS-1$

	private final Logger logger = LoggerFactory.getLogger(CloudSyncQueueDao.class);

	@Autowired
	private BasicDataSource dataSource;

	private JdbcTemplate jdbcTemplate;
	private volatile boolean tableEnsured = false;

	/** Item queued for upload (or tombstone upload when {@link #isDeleted()}). */
	public static class QueueItem {
		private final String recordKey;
		private final String surveyUri;
		private final String operator;
		private final Date localModifiedOn;
		private final int attempts;
		private final boolean deleted;

		public QueueItem(String recordKey, String surveyUri, String operator, Date localModifiedOn, int attempts,
				boolean deleted) {
			this.recordKey = recordKey;
			this.surveyUri = surveyUri;
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
			return new QueueItem(rs.getString("record_key"), rs.getString("survey_uri"), rs.getString("operator"), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					rs.getTimestamp("local_modified_on"), rs.getInt("attempts"), rs.getInt("deleted") != 0); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		}
	};

	private synchronized JdbcTemplate jdbc() {
		if (jdbcTemplate == null) {
			jdbcTemplate = new JdbcTemplate(dataSource);
		}
		if (!tableEnsured) {
			jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE + " (" //$NON-NLS-1$ //$NON-NLS-2$
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
					+ "PRIMARY KEY (record_key, survey_uri))"); //$NON-NLS-1$
			tableEnsured = true;
		}
		return jdbcTemplate;
	}

	/**
	 * Adds or refreshes a queue entry for a locally saved (or deleted) record. If a
	 * row already exists it is reset to PENDING with a new modification time so the
	 * next sync cycle picks it up again.
	 */
	public synchronized void enqueue(String recordKey, String surveyUri, String operator, Date localModifiedOn,
			boolean deleted) {
		Timestamp modifiedOn = toTimestamp(localModifiedOn);
		int updated = jdbc().update(
				"UPDATE " + TABLE //$NON-NLS-1$
						+ " SET sync_status = ?, operator = ?, local_modified_on = ?, deleted = ?, attempts = 0, next_attempt_on = NULL, last_error = NULL" //$NON-NLS-1$
						+ " WHERE record_key = ? AND survey_uri = ?", //$NON-NLS-1$
				STATUS_PENDING, operator, modifiedOn, deleted ? 1 : 0, recordKey, surveyUri);
		if (updated == 0) {
			jdbc().update(
					"INSERT INTO " + TABLE //$NON-NLS-1$
							+ " (record_key, survey_uri, operator, local_modified_on, sync_status, attempts, deleted) VALUES (?,?,?,?,?,0,?)", //$NON-NLS-1$
					recordKey, surveyUri, operator, modifiedOn, STATUS_PENDING, deleted ? 1 : 0);
		}
	}

	/** Returns up to {@code limit} items due for upload (PENDING, or FAILED past their backoff). */
	public synchronized List<QueueItem> takeDue(int limit, Date now) {
		return jdbc().query(
				"SELECT record_key, survey_uri, operator, local_modified_on, attempts, deleted FROM " + TABLE //$NON-NLS-1$
						+ " WHERE record_key <> ? AND sync_status IN ('" + STATUS_PENDING + "','" + STATUS_FAILED + "')" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
						+ " AND (next_attempt_on IS NULL OR next_attempt_on <= ?) ORDER BY local_modified_on LIMIT " + limit, //$NON-NLS-1$
				ITEM_MAPPER, WATERMARK_KEY, toTimestamp(now));
	}

	public synchronized void markSynced(String recordKey, String surveyUri, Date syncedOn) {
		jdbc().update(
				"UPDATE " + TABLE + " SET sync_status = ?, synced_on = ?, last_error = NULL WHERE record_key = ? AND survey_uri = ?", //$NON-NLS-1$ //$NON-NLS-2$
				STATUS_SYNCED, toTimestamp(syncedOn), recordKey, surveyUri);
	}

	public synchronized void markFailed(String recordKey, String surveyUri, String error, Date nextAttemptOn) {
		jdbc().update(
				"UPDATE " + TABLE //$NON-NLS-1$
						+ " SET sync_status = ?, attempts = attempts + 1, next_attempt_on = ?, last_error = ? WHERE record_key = ? AND survey_uri = ?", //$NON-NLS-1$
				STATUS_FAILED, toTimestamp(nextAttemptOn), abbreviate(error), recordKey, surveyUri);
	}

	public synchronized void markConflict(String recordKey, String surveyUri, String error) {
		jdbc().update(
				"UPDATE " + TABLE + " SET sync_status = ?, last_error = ? WHERE record_key = ? AND survey_uri = ?", //$NON-NLS-1$ //$NON-NLS-2$
				STATUS_CONFLICT, abbreviate(error), recordKey, surveyUri);
	}

	/** The last time the reconciliation scan ran for the given survey, or null if never. */
	public synchronized Date getReconciliationWatermark(String surveyUri) {
		List<Timestamp> results = jdbc().query(
				"SELECT synced_on FROM " + TABLE + " WHERE record_key = ? AND survey_uri = ?", //$NON-NLS-1$ //$NON-NLS-2$
				(rs, i) -> rs.getTimestamp(1), WATERMARK_KEY, surveyUri);
		return results.isEmpty() ? null : results.get(0);
	}

	public synchronized void setReconciliationWatermark(String surveyUri, Date watermark) {
		Timestamp ts = toTimestamp(watermark);
		int updated = jdbc().update(
				"UPDATE " + TABLE + " SET synced_on = ? WHERE record_key = ? AND survey_uri = ?", //$NON-NLS-1$ //$NON-NLS-2$
				ts, WATERMARK_KEY, surveyUri);
		if (updated == 0) {
			jdbc().update(
					"INSERT INTO " + TABLE //$NON-NLS-1$
							+ " (record_key, survey_uri, sync_status, attempts, deleted, synced_on) VALUES (?,?,?,0,0,?)", //$NON-NLS-1$
					WATERMARK_KEY, surveyUri, STATUS_SYNCED, ts);
		}
	}

	public synchronized QueueStatus getStatus() {
		final Map<String, Integer> counts = new HashMap<>();
		jdbc().query("SELECT sync_status, COUNT(*) FROM " + TABLE + " WHERE record_key <> ? GROUP BY sync_status", //$NON-NLS-1$ //$NON-NLS-2$
				rs -> {
					counts.put(rs.getString(1), rs.getInt(2));
				}, WATERMARK_KEY);
		Timestamp lastSynced = queryOptionalTimestamp(
				"SELECT MAX(synced_on) FROM " + TABLE + " WHERE record_key <> ? AND sync_status = '" + STATUS_SYNCED + "'"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		List<String> lastErrors = jdbc().query(
				"SELECT last_error FROM " + TABLE + " WHERE record_key <> ? AND last_error IS NOT NULL" //$NON-NLS-1$ //$NON-NLS-2$
						+ " ORDER BY next_attempt_on DESC LIMIT 1", //$NON-NLS-1$
				(rs, i) -> rs.getString(1), WATERMARK_KEY);
		return new QueueStatus(
				counts.getOrDefault(STATUS_PENDING, 0),
				counts.getOrDefault(STATUS_FAILED, 0) + counts.getOrDefault(STATUS_CONFLICT, 0),
				counts.getOrDefault(STATUS_SYNCED, 0),
				lastSynced,
				lastErrors.isEmpty() ? null : lastErrors.get(0));
	}

	private Timestamp queryOptionalTimestamp(String sql) {
		List<Timestamp> results = jdbc().query(sql, (rs, i) -> rs.getTimestamp(1), WATERMARK_KEY);
		return results.isEmpty() ? null : results.get(0);
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
