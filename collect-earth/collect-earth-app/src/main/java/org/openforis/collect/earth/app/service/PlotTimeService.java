package org.openforis.collect.earth.app.service;

import org.apache.commons.dbcp2.BasicDataSource;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * How long the interpreter has been working on each plot: its <b>active time</b>, sent to the cloud with the plot's
 * record so the dashboard can tell a plot assessed with care from one answered in a hurry.
 *
 * <p>
 * The time counts from the plot's form opening to its last save, summed over every time it is opened. Each sign of work
 * on the plot (the form loading it, a save, an entity added or removed, the web form's "still here" while the
 * interpreter uses it) adds the time since the previous sign of work on <i>the same plot</i>, when that is at most
 * {@link #IDLE_MS}: a longer pause (a break, a plot left open overnight) adds nothing, and work on another plot in
 * between ends the plot's stretch. So the same minute is never counted for two plots.
 * </p>
 *
 * <p>
 * It is kept in the database of the records (table {@code ce_plot_time}, through the shared {@code dataSource}, as the
 * cloud queue is), per survey and record key, so it survives a restart and stays with the data.
 * </p>
 */
@Component
public class PlotTimeService {

	/** A pause longer than this between two signs of work on a plot is not counted. */
	public static final long IDLE_MS = 5 * 60 * 1000L;

	private static final String TABLE = "ce_plot_time"; //$NON-NLS-1$

	private final Logger logger = LoggerFactory.getLogger(PlotTimeService.class);

	@Autowired(required = false)
	private BasicDataSource dataSource;
	@Autowired(required = false)
	private EarthSurveyService earthSurveyService;

	private final Clock clock = new Clock(IDLE_MS);
	private JdbcTemplate jdbcTemplate;
	private volatile boolean tableEnsured = false;

	/**
	 * The stretch of work in progress: which plot, and when it was last worked on. Pure, so the counting rule is tested
	 * on its own.
	 */
	public static class Clock {
		private final long idleMs;
		private String plot;
		private long last;

		public Clock(long idleMs) {
			this.idleMs = idleMs;
		}

		/** A sign of work on a plot at a time: the milliseconds it adds to that plot's active time. */
		public synchronized long work(String plotKey, long nowMs) {
			long added = 0;
			if (plotKey.equals(plot)) {
				long gap = nowMs - last;
				if (gap > 0 && gap <= idleMs) {
					added = gap;
				}
			}
			plot = plotKey;
			last = nowMs;
			return added;
		}
	}

	/** A sign of work on a plot (its record key, the key values joined by commas) now. Never throws. */
	public void work(String plotKey) {
		if (plotKey == null || plotKey.trim().isEmpty()) {
			return;
		}
		workAt(surveyUri(), plotKey, System.currentTimeMillis());
	}

	void workAt(String surveyUri, String plotKey, long nowMs) {
		long added = clock.work(plotKey, nowMs);
		if (added <= 0 || surveyUri == null || dataSource == null) {
			return;
		}
		try {
			add(surveyUri, plotKey, added);
		} catch (Exception e) {
			// the time is a figure for the coordinators: a failure to count it must never stop the work
			logger.warn("Could not count the time spent on plot {}: {}", plotKey, e.getMessage());
		}
	}

	/** A plot's active time in whole seconds, or null when none was counted (an older record, another machine). */
	public Integer activeSeconds(String surveyUri, String recordKey) {
		if (surveyUri == null || recordKey == null || dataSource == null) {
			return null;
		}
		try {
			Long ms = jdbc().queryForObject("SELECT active_ms FROM " + TABLE + " WHERE survey_uri = ? AND record_key = ?", //$NON-NLS-1$ //$NON-NLS-2$
					Long.class, surveyUri, recordKey);
			return ms == null ? null : Integer.valueOf((int) Math.min(Integer.MAX_VALUE, Math.round(ms / 1000.0)));
		} catch (EmptyResultDataAccessException e) {
			return null;
		} catch (Exception e) {
			logger.warn("Could not read the time spent on plot {}: {}", recordKey, e.getMessage());
			return null;
		}
	}

	private synchronized void add(String surveyUri, String recordKey, long ms) {
		JdbcTemplate jdbc = jdbc();
		int updated = jdbc.update("UPDATE " + TABLE + " SET active_ms = active_ms + ? WHERE survey_uri = ? AND record_key = ?", //$NON-NLS-1$ //$NON-NLS-2$
				ms, surveyUri, recordKey);
		if (updated == 0) {
			jdbc.update("INSERT INTO " + TABLE + " (survey_uri, record_key, active_ms) VALUES (?, ?, ?)", surveyUri, //$NON-NLS-1$ //$NON-NLS-2$
					recordKey, ms);
		}
	}

	private String surveyUri() {
		CollectSurvey survey = earthSurveyService == null ? null : earthSurveyService.getCollectSurvey();
		return survey == null ? null : survey.getUri();
	}

	private synchronized JdbcTemplate jdbc() {
		if (jdbcTemplate == null) {
			jdbcTemplate = new JdbcTemplate(dataSource);
		}
		if (!tableEnsured) {
			jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE + " (" //$NON-NLS-1$ //$NON-NLS-2$
					+ "survey_uri VARCHAR(255) NOT NULL, " //$NON-NLS-1$
					+ "record_key VARCHAR(2048) NOT NULL, " //$NON-NLS-1$
					+ "active_ms BIGINT DEFAULT 0 NOT NULL, " //$NON-NLS-1$
					+ "PRIMARY KEY (survey_uri, record_key))"); //$NON-NLS-1$
			tableEnsured = true;
		}
		return jdbcTemplate;
	}

	/** For tests: a service over a data source of its own. */
	void setDataSource(BasicDataSource dataSource) {
		this.dataSource = dataSource;
	}
}
