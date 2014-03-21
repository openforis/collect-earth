package org.openforis.collect.earth.app.service;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.Charset;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.annotation.PostConstruct;

import org.apache.commons.dbcp.BasicDataSource;
import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.model.AspectCode;
import org.openforis.collect.earth.sampler.model.SlopeCode;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
import org.openforis.collect.relational.model.RelationalSchemaConfig;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

@Component
public class AnalysisSaikuService {

	private static final String START_SAIKU_BAT = "start-saiku.bat";

	private static final String STOP_SAIKU_BAT = "stop-saiku.bat";

	private static final String COLLECT_EARTH_DATABASE_RDB_DB = "collectEarthDatabaseRDB.db";

	@Autowired
	CollectRDBPublisher collectRDBPublisher;

	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	LocalPropertiesService localPropertiesService;

	@Autowired
	BrowserService browserService;

	@Autowired
	private BasicDataSource rdbDataSource;

	private JdbcTemplate jdbcTemplate;

	private final Logger logger = LoggerFactory.getLogger(AnalysisSaikuService.class);

	private static final int ELEVATION_RANGE = 100;

	private RemoteWebDriver saikuWebDriver;

	private boolean refreshDatabase;

	private static final String FREEMARKER_HTML_TEMPLATE = "resources/collectEarthDS.fmt";

	private static final String MDX_XML = "collectEarthCubes.xml";

	private boolean userCancelledOperation = false;

	public boolean isUserCancelledOperation() {
		return userCancelledOperation;
	}

	public void setUserCancelledOperation(boolean userCancelledOperation) {
		this.userCancelledOperation = userCancelledOperation;
	}


	public void prepareDataForAnalysis() throws SaikuExecutionException {

		try {
			stopSaiku();

			try {
				if (!getRdbFile().exists() || isRefreshDatabase()) {
					
					long time = System.currentTimeMillis();
					removeOldRdb();
					/*
					 * The SQLite DB has no limit on the length of the varchar.
					 * By default, if no RelationalSchemaConfig is passed to the export command text fields will be truncated to 255 characters
					 */
					RelationalSchemaConfig rdbConfig = RelationalSchemaConfig.createDefault();
					rdbConfig.setTextMaxLength(4096);
					rdbConfig.setMemoMaxLength(4096);
					collectRDBPublisher.export(earthSurveyService.getCollectSurvey().getName(), EarthConstants.ROOT_ENTITY_NAME, Step.ENTRY, null, rdbConfig );
					System.out.println( "Export takes " + ( System.currentTimeMillis() - time  ) );
					time = System.currentTimeMillis();
					refreshDataSourceForSaiku();
					System.out.println( "Refresh takes " + ( System.currentTimeMillis() - time  ) );
					if( !isUserCancelledOperation() ){
						time = System.currentTimeMillis();
						try {
							processQuantityData();
							System.out.println( "Prcoessing takes " + ( System.currentTimeMillis() - time  ) );
						} catch (Exception e) {
							logger.error("Error processing quantity data", e );
						}
					}
					
				}

				if( !isUserCancelledOperation() ){
					startSaiku();
					new Thread() {
						@Override
						public void run() {
							try {
								AnalysisSaikuService.this.openSaiku();
							} catch (final IOException e) {
								logger.error("Error opening the Saiku interface", e);
							}
						};
					}.start();

					stopSaikuOnExit();
				}
			} catch (final IOException e) {
				logger.error("Error while producing Relational DB from Collect format", e);
			} 

		} catch (final CollectRdbException e) {
			logger.error("Error while producing Relational DB from Collect format", e);
		}
	}

	private void assignDimensionValues() {

		// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
		final List<Object[]> sqlUpdateValues = jdbcTemplate.query("SELECT _plot_id, elevation, slope, aspect FROM plot", new RowMapper<Object[]>() {
			@Override
			public Object[] mapRow(ResultSet rs, int rowNum) throws SQLException {

				final Object[] updateValues = new Object[4];

				Integer aspect = AspectCode.NA.getId();
				if (AspectCode.getAspectCode(rs.getDouble("aspect")) != null) {
					aspect = AspectCode.getAspectCode(rs.getDouble("aspect")).getId();
				}

				Integer slope = SlopeCode.NA.getId();

				if (SlopeCode.getSlopeCode((int) rs.getFloat("slope")) != null) {
					slope = SlopeCode.getSlopeCode((int) rs.getFloat("slope")).getId();
				}

				updateValues[0] = aspect;
				updateValues[1] = slope;
				updateValues[2] = Math.floor((int) rs.getFloat("elevation") / ELEVATION_RANGE) + 1; // 0 meters is bucket 1 ( id);
				updateValues[3] = rs.getLong("_plot_id");
				return updateValues;
			}

		});

		jdbcTemplate.batchUpdate("UPDATE plot SET aspect_id=?,slope_id=?,elevation_id=? WHERE _plot_id=?", sqlUpdateValues);
	}

	private void createAspectAuxTable() {
		jdbcTemplate.execute("CREATE TABLE aspect_category (aspect_id INTEGER PRIMARY KEY, aspect_caption TEXT);");
		final AspectCode[] aspects = AspectCode.values();
		for (final AspectCode aspectCode : aspects) {
			jdbcTemplate.execute("INSERT INTO aspect_category values (" + aspectCode.getId() + ", '" + aspectCode.getLabel() + "')");
		}
	}

	private void createElevationtAuxTable() {

		jdbcTemplate.execute("CREATE TABLE elevation_category (elevation_id INTEGER PRIMARY KEY, elevation_caption TEXT);");
		final int slots = (int) Math.ceil(9000 / ELEVATION_RANGE); // Highest mountain in the world, mount everest is 8820m high
		for (int i = 1; i <= slots; i++) {
			jdbcTemplate.execute("INSERT INTO elevation_category values (" + i + ", '" + ((i - 1) * ELEVATION_RANGE) + "-" + i * ELEVATION_RANGE
					+ "')");
		}

	}

	private void createPlotForeignKeys() {
		// Add aspect_id column to plot
		jdbcTemplate.execute("ALTER TABLE plot ADD aspect_id INTEGER");
		jdbcTemplate.execute("ALTER TABLE plot ADD slope_id INTEGER");
		jdbcTemplate.execute("ALTER TABLE plot ADD elevation_id INTEGER");
	}

	private void createSlopeAuxTable() {
		// Slope can be from 0 to 90
		jdbcTemplate.execute("CREATE TABLE slope_category (slope_id INTEGER PRIMARY KEY, slope_caption TEXT);");
		final SlopeCode[] slopeCodes = SlopeCode.values();
		for (final SlopeCode slopeCode : slopeCodes) {
			jdbcTemplate.execute("INSERT INTO slope_category values (" + slopeCode.getId() + ", '" + slopeCode.getLabel() + "')");
		}
	}

	private String getIdmFolder() {
		final File metadataFile = new File(localPropertiesService.getValue(EarthProperty.METADATA_FILE));
		return metadataFile.getParent();
	}

	private File getRdbFile() {
		return new File(COLLECT_EARTH_DATABASE_RDB_DB);
	}

	private String getSaikuConfigurationFilePath() {
		final String saikuFolder = localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER);
		String configFile = saikuFolder + "/" + "tomcat/webapps/saiku/WEB-INF/classes/saiku-datasources/collectEarthDS";
		configFile = configFile.replace('/', File.separatorChar);
		return configFile;
	}

	private String getSaikuFolder() {
		final String configuredSaikuFolder = localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER);
		if (StringUtils.isBlank(configuredSaikuFolder)) {
			return "";
		} else {
			final File saikuFolder = new File(configuredSaikuFolder);
			return saikuFolder.getAbsolutePath();
		}
	}

	@PostConstruct
	public void initialize() {
		jdbcTemplate = new JdbcTemplate(rdbDataSource);
	}

	public boolean isRefreshDatabase() {
		return refreshDatabase;
	}

	public boolean isSaikuConfigured() {
		return getSaikuFolder() != null && isSaikuFolder(new File(getSaikuFolder()));
	}

	public boolean isSaikuFolder(File saikuFolder) {
		boolean isSaikuFolder = false;
		if (saikuFolder.listFiles() != null) {
			for (final File file : saikuFolder.listFiles()) {
				if (file.getName().equals(START_SAIKU_BAT)) {
					isSaikuFolder = true;
				}
			}
		}
		return isSaikuFolder;
	}

	private void openSaiku() throws IOException {

		saikuWebDriver = browserService.navigateTo("http://localhost:8181", saikuWebDriver);
		browserService.waitFor("username", saikuWebDriver);

		saikuWebDriver.findElementByName("username").sendKeys("admin");
		saikuWebDriver.findElementByName("password").sendKeys("admin");
		saikuWebDriver.findElementByClassName("form_button").click();

	}

	private void processQuantityData() throws SQLException {
		long time = System.currentTimeMillis();
		createAspectAuxTable();
		System.out.println( "Process 1 " + ( System.currentTimeMillis() - time  ) );
		time = System.currentTimeMillis();
		createSlopeAuxTable();
		System.out.println( "Process 2 " + ( System.currentTimeMillis() - time  ) );
		time = System.currentTimeMillis();
		createElevationtAuxTable();
		System.out.println( "Process 3 " + ( System.currentTimeMillis() - time  ) );
		time = System.currentTimeMillis();
		createPlotForeignKeys();
		System.out.println( "Process 4 " + ( System.currentTimeMillis() - time  ) );
		time = System.currentTimeMillis();
		assignDimensionValues();
		System.out.println( " Process  5 " + ( System.currentTimeMillis() - time  ) );
		time = System.currentTimeMillis();
	}

	private void refreshDataSourceForSaiku() throws IOException {

		final HashMap<String, String> data = new HashMap<String, String>();

		final File rdbDb = getRdbFile();
		final File cubeDefinition = new File(getIdmFolder() + File.separatorChar + MDX_XML);
		final File dataSourceTemplate = new File(KmlGenerator.convertToOSPath(FREEMARKER_HTML_TEMPLATE));

		if (!rdbDb.exists()) {
			throw new IOException("The file contianing the Relational SQLite Database does not exist in expected location " + rdbDb.getAbsolutePath());
		}

		if (!cubeDefinition.exists()) {
			throw new IOException("The file contianing the MDX Cube definition does not exist in expected location "
					+ cubeDefinition.getAbsolutePath());
		}

		if (!dataSourceTemplate.exists()) {
			throw new IOException("The file contianing the Saiku Data Source template does not exist in expected location "
					+ dataSourceTemplate.getAbsolutePath());
		}

		data.put("rdbFilePath", rdbDb.getAbsolutePath().replace('\\', '/'));
		data.put("cubeFilePath", cubeDefinition.getAbsolutePath().replace('\\', '/'));

		// Process the template file using the data in the "data" Map
		final Configuration cfg = new Configuration();

		cfg.setDirectoryForTemplateLoading(dataSourceTemplate.getParentFile());

		// Load template from source folder
		final Template template = cfg.getTemplate(dataSourceTemplate.getName());

		final File saikuConfigFile = new File(getSaikuConfigurationFilePath());

		// Console output
		BufferedWriter fw = null;
		try {
			fw = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(saikuConfigFile), Charset.forName("UTF-8")));
			template.process(data, fw);
		} catch (final TemplateException e) {
			logger.error("Problemsa when processing the template for the Saiku data source", e);
		} finally {
			if (fw != null) {
				fw.close();
			}
		}

	}

	private void removeOldRdb() {

		final List<String> tables = new ArrayList<String>();
		final List<Map<String, Object>> listOfTables = jdbcTemplate.queryForList("SELECT name FROM sqlite_master WHERE type='table';");
		for (final Map<String, Object> entry : listOfTables) {
			final String tableName = (String) entry.get("name");
			if (!tableName.equals("sqlite_sequence")) {
				tables.add(tableName);
			}

		}

		for (final String tableName : tables) {
			jdbcTemplate.execute("DROP TABLE IF EXISTS " + tableName);
		}

		final File oldRdbFile = getRdbFile();
		oldRdbFile.delete();

	}

	private void runSaikuBat(String batName) throws SaikuExecutionException {
		if (!isSaikuConfigured()) {
			throw new SaikuExecutionException("The Saiku server is not configured.");
		} else {
			final String saikuCmd = "\"" + getSaikuFolder() + File.separator + batName + "\"";
			try {
				final ProcessBuilder builder = new ProcessBuilder(new String[] { saikuCmd });
				builder.directory(new File(getSaikuFolder()));
				builder.redirectErrorStream(true);
				builder.start();
			} catch (final IOException e) {
				logger.error("Error when running Saiku start/stop command", saikuCmd);
			}
		}
	}

	public void setRefreshDatabase(boolean refreshDatabase) {
		this.refreshDatabase = refreshDatabase;
	}

	private void startSaiku() throws SaikuExecutionException {
		logger.warn("Starting the Saiku server" + getSaikuFolder() + File.separator + START_SAIKU_BAT);

		runSaikuBat(START_SAIKU_BAT);

		logger.warn("Finished starting the Saiku server");
	}

	private void stopSaiku() throws SaikuExecutionException {
		logger.warn("Stoping the Saiku server" + getSaikuFolder() + File.separator + STOP_SAIKU_BAT);

		runSaikuBat(STOP_SAIKU_BAT);

		logger.warn("Finished stoping the Saiku server");
	}

	private void stopSaikuOnExit() {
		Runtime.getRuntime().addShutdownHook(new Thread() {
			@Override
			public void run() {
				try {
					stopSaiku();
				} catch (final SaikuExecutionException e) {
					logger.error("The Saiku server has been de-configured after it was started", e);
				}
			}

		});
	}

}
