package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.IOException;
import java.lang.ProcessBuilder.Redirect;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

import javax.sql.DataSource;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.model.AspectCode;
import org.openforis.collect.earth.sampler.model.SlopeCode;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class AnalysisSaikuService {

	@Autowired
	CollectRDBPublisher collectRDBPublisher;

	@Autowired
	SurveyManager surveyManager;

	@Autowired
	LocalPropertiesService localPropertiesService;

	@Autowired
	BrowserService browserService;

	@Autowired
	@Qualifier("rdbDataSource")
	private DataSource rdbDataSource;

	private static final int ELEVATION_BUCKET_RANGE = 100;
	
	private JdbcTemplate jdbcTemplate;

	private final Logger logger = LoggerFactory.getLogger(AnalysisSaikuService.class);
	
	class ElevationBuket{
		private int id;
		private String caption;
		private int lowerLimit;
		private int upperLimit;
	}

	private void assignDimensionValues() {

		// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
		final List<Object[]> sqlUpdateValues = jdbcTemplate.query("SELECT _plot_id, elevation, slope, aspect FROM plot", new RowMapper<Object[]>() {
			@Override
			public Object[] mapRow(ResultSet rs, int rowNum) throws SQLException {

				final Object[] updateValues = new Object[4];

				Integer aspect = AspectCode.NA.getId();
				if( AspectCode.getHumanReadableAspect(rs.getDouble("aspect")) != null  ){
					aspect = AspectCode.getHumanReadableAspect(rs.getDouble("aspect")).getId();
				}
				
				Integer slope = SlopeCode.NA.getId();
				
				if( SlopeCode.getSlopeCode( (int) rs.getFloat("slope")) != null ){
					slope = SlopeCode.getSlopeCode( (int)rs.getFloat("slope") ).getId();
				}
				
				Integer elevationBucket = 0;
				updateValues[0] = aspect;
				updateValues[1] = slope;
				updateValues[2] = elevationBucket;
				updateValues[3] = rs.getInt("_plot_id");
				return updateValues;
			}

		});

		jdbcTemplate.batchUpdate("UPDATE plot SET aspect_id=?,slope_id=?,elevation_bucket_id=? WHERE _plot_id=?", sqlUpdateValues);
	}

	private void copyDbToSaikuFolder() throws IOException {
		FileUtils.copyFile(new File("collectEarthDatabaseRDB.db"), new File(getSaikuFolder() + File.separatorChar + "collectEarthDatabaseRDB.db"));

	}

	private void createAspectAuxTable() {
		jdbcTemplate.execute("CREATE TABLE aspect_category (aspect_id INTEGER PRIMARY KEY, aspect_caption TEXT);");
		final AspectCode[] aspects = AspectCode.values();
		for (final AspectCode aspectCode : aspects) {
			jdbcTemplate.execute("INSERT INTO aspect_category values (" + aspectCode.getId() + ", '" + aspectCode.getLabel() + "')");
		}
	}

	private void createElevationtAuxTable() {
		// TODO Auto-generated method stub

	}

	private void createPlotForeignKeys() {
		// Add aspect_id column to plot
		jdbcTemplate.execute("ALTER TABLE plot ADD aspect_id INTEGER");
		jdbcTemplate.execute("ALTER TABLE plot ADD slope_id INTEGER");
		jdbcTemplate.execute("ALTER TABLE plot ADD elevation_bucket_id INTEGER");
	}

	private void createSlopeAuxTable() {
		// Slope can be from 0 to 90
		jdbcTemplate.execute("CREATE TABLE slope_category (slope_id INTEGER PRIMARY KEY, slope_caption TEXT);");
		final SlopeCode[] slopeCodes = SlopeCode.values();
		for (final SlopeCode slopeCode : slopeCodes) {
			jdbcTemplate.execute("INSERT INTO slope_category values (" + slopeCode.getId() + ", '" + slopeCode.getLabel() + "')");
		}
	}

	private List<Integer> addELevationBuckets() {
		// TODO Auto-generated method stub
		return null;
	}

	private String getSaikuFolder() {
		return localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER);
	}

	private void openSaiku() throws IOException {
		browserService.navigateTo(" http://localhost:8181", null);
	}

	public void prepareAnalysis() {

		try {
			removeOldRdb();
			collectRDBPublisher.export(EarthConstants.EARTH_SURVEY_NAME, EarthConstants.ROOT_ENTITY_NAME, Step.ENTRY, null);

			try {
				copyDbToSaikuFolder();
				processQuantityData();
				startSaiku();
				openSaiku();
				stopSaikuOnExit();
			} catch (final IOException e) {
				logger.error("Error while producing Relational DB from Collect format", e);
			} catch (final SQLException e) {
				logger.error("Problems when creating aspect and elevation dimensions", e);
			}

		} catch (final CollectRdbException e) {
			logger.error("Error while producing Relational DB from Collect format", e);
		}
	}

	private void processQuantityData() throws SQLException {

		jdbcTemplate = new JdbcTemplate(rdbDataSource);
		createAspectAuxTable();
		createSlopeAuxTable();
		createElevationtAuxTable();

		createPlotForeignKeys();

		assignDimensionValues();
	}

	private void removeOldRdb() {
		final File oldRdbFile = new File("collectEarthDatabaseRDB.db");
		oldRdbFile.delete();
	}

	private void startSaiku() throws IOException {
		final String openSaikuCmd = getSaikuFolder() + File.separator + "start-saiku.bat";
		final ProcessBuilder builder = new ProcessBuilder(openSaikuCmd);
		builder.directory(new File(getSaikuFolder()));
		builder.redirectErrorStream(true);
		builder.redirectOutput(Redirect.INHERIT);
		builder.redirectError(Redirect.INHERIT);
		builder.start();

	}

	private void stopSaikuOnExit() {
		Runtime.getRuntime().addShutdownHook(new Thread() {
			@Override
			public void run() {
				final String endSaikuCmd = getSaikuFolder() + File.separator + "stop-saiku.bat";
				try {
					final ProcessBuilder builder = new ProcessBuilder(endSaikuCmd);
					builder.directory(new File(getSaikuFolder()));
					builder.redirectErrorStream(true);
					builder.redirectOutput(Redirect.INHERIT);
					builder.redirectError(Redirect.INHERIT);
					builder.start();
				} catch (final IOException e) {
					logger.error("Error stopping Saiku", e);
				}
			}
		});
	}

}
