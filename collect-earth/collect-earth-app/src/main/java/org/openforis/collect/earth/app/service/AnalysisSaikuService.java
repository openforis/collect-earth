package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStreamReader;
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
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.model.AspectCode;
import org.openforis.collect.earth.app.model.DynamicsCode;
import org.openforis.collect.earth.app.model.SlopeCode;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
import org.openforis.collect.relational.model.RelationalSchemaConfig;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import au.com.bytecode.opencsv.CSVReader;

@Component
public class AnalysisSaikuService {

	private static final String POSTGRES_RDB_SCHEMA = "rdbcollectsaiku";

	private static final String START_SAIKU = "start-saiku";

	private static final String STOP_SAIKU = "stop-saiku";
	
	private static final String COMMAND_SUFFIX_BAT = ".bat";
	private static final String COMMAND_SUFFIX_SH = ".sh";

	private static final String COLLECT_EARTH_DATABASE_RDB_DB = EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB + ServerController.SAIKU_RDB_SUFFIX;

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

	private static final String SQLITE_FREEMARKER_HTML_TEMPLATE = "resources" + File.separator + "collectEarthSqliteDS.fmt";
	private static final String POSTGRESQL_FREEMARKER_HTML_TEMPLATE = "resources" + File.separator + "collectEarthPostgreSqlDS.fmt";

	private static final String MDX_XML = "collectEarthCubes.xml";
	private static final String MDX_TEMPLATE = MDX_XML + ".fmt";

	private static final String REGION_AREAS_CSV = "region_areas.csv";

	private boolean userCancelledOperation = false;

	private void assignDimensionValues() {
		try {
			final String schemaName = getSchemaPrefix();
			// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
			final List<Object[]> sqlUpdateValues = jdbcTemplate.query("SELECT _plot_id, elevation, slope, aspect FROM " + schemaName + "plot",
					new RowMapper<Object[]>() {
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

			jdbcTemplate.batchUpdate("UPDATE " + schemaName + "plot SET aspect_id=?,slope_id=?,elevation_id=? WHERE _plot_id=?", sqlUpdateValues);
		} catch (DataAccessException e) {
			logger.error("No DEM information", e);
		}
	}

	private void assignLUCDimensionValues() {
		try {
			final String schemaName = getSchemaPrefix();
			// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
			final List<Object[]> sqlUpdateValues = jdbcTemplate.query("SELECT _plot_id, land_use_subcategory FROM " + schemaName + "plot",
					new RowMapper<Object[]>() {
						@Override
						public Object[] mapRow(ResultSet rs, int rowNum) throws SQLException {

							final Object[] updateValues = new Object[2];


							Integer dynamics = DynamicsCode.getDynamicsCode( rs.getString("land_use_subcategory"));


							updateValues[0] = dynamics;
							updateValues[1] = rs.getLong("_plot_id");
							return updateValues;
						}

					});

			jdbcTemplate.batchUpdate("UPDATE " + schemaName + "plot SET dynamics_id=? WHERE _plot_id=?", sqlUpdateValues);
		} catch (DataAccessException e) {
			logger.error("No Land Use subcategory information", e);
		}
	}

	private void cleanPostgresDb() {
		jdbcTemplate.execute("DROP SCHEMA IF EXISTS " + POSTGRES_RDB_SCHEMA + " CASCADE");
		jdbcTemplate.execute("CREATE SCHEMA IF NOT EXISTS " + POSTGRES_RDB_SCHEMA);
	}

	private void cleanSqlLiteDb(final List<String> tables) {
		final File oldRdbFile = getRdbFile();
		if(oldRdbFile.exists() ){
			// We need to delete all tables before we can remove the file and drop the connection
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
			

			// Now we can remove the SQLite file so that a completely new connection is open
			oldRdbFile.delete();
			
			if (!SystemUtils.IS_OS_WINDOWS){
				try {
					Thread.yield();
					Thread.sleep( 10000 );
				} catch (InterruptedException e) {
					// TODO Auto-generated catch block
					e.printStackTrace();
				}
			}
			
			logger.warn("The sqlite database has been removed : " + oldRdbFile.getAbsolutePath() );
		}

	}

	private void createAspectAuxTable() {
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("CREATE TABLE " + schemaName + "aspect_category (aspect_id INTEGER PRIMARY KEY, aspect_caption TEXT);");
		final AspectCode[] aspects = AspectCode.values();
		for (final AspectCode aspectCode : aspects) {
			jdbcTemplate
			.execute("INSERT INTO " + schemaName + "aspect_category values (" + aspectCode.getId() + ", '" + aspectCode.getLabel() + "')");
		}
	}

	private void createElevationtAuxTable() {
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("CREATE TABLE " + schemaName + "elevation_category (elevation_id INTEGER PRIMARY KEY, elevation_caption TEXT);");
		final int slots = (int) Math.ceil(9000 / ELEVATION_RANGE); // Highest mountain in the world, mount everest is 8820m high
		for (int i = 1; i <= slots; i++) {
			jdbcTemplate.execute("INSERT INTO " + schemaName + "elevation_category values (" + i + ", '" + ((i - 1) * ELEVATION_RANGE) + "-" + i
					* ELEVATION_RANGE + "')");
		}

	}

	private void createDynamicsAuxTable() {
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("CREATE TABLE " + schemaName + "dynamics_category (dynamics_id INTEGER PRIMARY KEY, dynamics_caption TEXT);");
		final DynamicsCode[] dynamicsCodes = DynamicsCode.values();
		for (final DynamicsCode dynamicsCode : dynamicsCodes) {
			jdbcTemplate
			.execute("INSERT INTO " + schemaName + "dynamics_category values (" + dynamicsCode.getId() + ", '" + dynamicsCode.getLabel() + "')");
		}
	}

	private void createPlotForeignKeys() {
		// Add aspect_id column to plot
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD aspect_id INTEGER");
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD slope_id INTEGER");
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD elevation_id INTEGER");
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD dynamics_id INTEGER");
	}

	private void createWeightFactors(){
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD expansion_factor FLOAT");
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD plot_weight FLOAT");
	}

	private void createSlopeAuxTable() {
		final String schemaName = getSchemaPrefix();
		// Slope can be from 0 to 90
		jdbcTemplate.execute("CREATE TABLE " + schemaName + "slope_category (slope_id INTEGER PRIMARY KEY, slope_caption TEXT);");
		final SlopeCode[] slopeCodes = SlopeCode.values();
		for (final SlopeCode slopeCode : slopeCodes) {
			jdbcTemplate.execute("INSERT INTO " + schemaName + "slope_category values (" + slopeCode.getId() + ", '" + slopeCode.getLabel() + "')");
		}
	}

	private String getIdmFolder() {
		final File metadataFile = new File(localPropertiesService.getImdFile() );
		return metadataFile.getParent();
	}

	private File getRdbFile() {
		return new File(COLLECT_EARTH_DATABASE_RDB_DB);
	}

	public boolean isRdbFilePresent(){
		File rdbFile = getRdbFile();

		return ( rdbFile!=null && rdbFile.exists() );
	}

	private String getSaikuConfigurationFilePath() {
		
		String configFile = getSaikuFolder() + "/" + "tomcat/webapps/saiku/WEB-INF/classes/saiku-datasources/collectEarthDS";
		configFile = configFile.replace('/', File.separatorChar);
		return configFile;
	}

	private String getSaikuFolder() {
		final String configuredSaikuFolder = localPropertiesService.convertToOSPath( localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER) );
		if (StringUtils.isBlank(configuredSaikuFolder)) {
			return "";
		} else {
			final File saikuFolder = new File(configuredSaikuFolder);
			return saikuFolder.getAbsolutePath();
		}
	}

	private String getSchemaName() {
		String schemaName = null;
		if (localPropertiesService.isUsingPostgreSqlDB()) {
			schemaName = POSTGRES_RDB_SCHEMA;
		}
		return schemaName;
	}

	private String getSchemaPrefix() {
		String schemaName = getSchemaName();
		if (schemaName != null) {
			schemaName += ".";
		} else {
			schemaName = "";
		}
		return schemaName;
	}

	@PostConstruct
	public void initialize() {
		jdbcTemplate = new JdbcTemplate(rdbDataSource);
	}


	private boolean isRefreshDatabase() {
		return refreshDatabase;
	}

	private boolean isSaikuConfigured() {
		return getSaikuFolder() != null && isSaikuFolder(new File(getSaikuFolder()));
	}

	public boolean isSaikuFolder(File saikuFolder) {
		boolean isSaikuFolder = false;
		if (saikuFolder.listFiles() != null) {
			for (final File file : saikuFolder.listFiles()) {
				if (file.getName().equals(START_SAIKU + getCommandSuffix())) {
					isSaikuFolder = true;
				}
			}
		}
		return isSaikuFolder;
	}

	private boolean isUserCancelledOperation() {
		return userCancelledOperation;
	}

	private void openSaiku() throws IOException {
		saikuWebDriver = browserService.navigateTo("http://localhost:8181", saikuWebDriver);
		browserService.waitFor("username", saikuWebDriver);
		saikuWebDriver.findElementByName("username").sendKeys("admin");
		saikuWebDriver.findElementByName("password").sendKeys("admin");
		saikuWebDriver.findElementByClassName("form_button").click();
	}

	public void prepareDataForAnalysis() throws SaikuExecutionException {

		try {
			stopSaiku();

			try {
				if (!getRdbFile().exists() || isRefreshDatabase()) {

					System.currentTimeMillis();
					removeOldRdb();
					/*
					 * The SQLite DB has no limit on the length of the varchar.
					 * By default, if no RelationalSchemaConfig is passed to the export command text fields will be truncated to 255 characters
					 */
					final RelationalSchemaConfig rdbConfig = RelationalSchemaConfig.createDefault();
					rdbConfig.setTextMaxLength(4096);
					rdbConfig.setMemoMaxLength(4096);

					final String rdbSaikuSchema = getSchemaName();

					collectRDBPublisher.export(earthSurveyService.getCollectSurvey().getName(), EarthConstants.ROOT_ENTITY_NAME, Step.ENTRY,
							rdbSaikuSchema, rdbConfig);

					if (!isUserCancelledOperation()) {
						System.currentTimeMillis();
						try {
							processQuantityData();
							setSaikuAsDefaultSchema();
						} catch (final Exception e) {
							logger.error("Error processing quantity data", e);
						}
					}
				}

				refreshDataSourceForSaiku();

				if (!isUserCancelledOperation()) {
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

	private void setSaikuAsDefaultSchema() {
		if( localPropertiesService.isUsingPostgreSqlDB() ){
			jdbcTemplate.execute("SET search_path TO " + getSchemaName() );
		}
	}

	private void processQuantityData() throws SQLException {

		createAspectAuxTable();

		createSlopeAuxTable();

		createElevationtAuxTable();

		createDynamicsAuxTable();

		createWeightFactors();

		createPlotForeignKeys();

		assignDimensionValues();

		assignLUCDimensionValues();

		addAreasPerRegion();

	}

	public static CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8")));
		reader = new CSVReader(bufferedReader, ',');
		return reader;
	}


	private void addAreasPerRegion() throws SQLException {

		final File regionAreas = new File(getIdmFolder() + File.separatorChar + REGION_AREAS_CSV);
		if (regionAreas.exists()) {

			try {
				CSVReader csvReader = KmlGenerator.getCsvReader(regionAreas.getAbsolutePath());
				String[] csvLine = null;

				while( ( csvLine = csvReader.readNext() ) != null ){
					try {
						String region = csvLine[0];
						String plot_file = csvLine[1];
						int area_hectars =  Integer.parseInt( csvLine[2] );
						final Float plot_weight =  Float.parseFloat( csvLine[3] );

						String[] parameters = new String[]{region,plot_file};

						String schemaName = getSchemaPrefix();
						int plots_per_region = jdbcTemplate.queryForInt( "SELECT count(_plot_id)FROM " + schemaName  + "plot  WHERE region=? OR plot_file=? ", parameters);

						Float expansion_factor_hectars_calc = 0f;
						if( plots_per_region != 0 ){
							expansion_factor_hectars_calc = (float)area_hectars / (float) plots_per_region;
						}

						final Float expansion_factor_hectars = expansion_factor_hectars_calc;

						final List<Object[]> sqlUpdateValues = jdbcTemplate.query("SELECT _plot_id FROM " + schemaName + "plot WHERE region=? OR plot_file=? ",parameters,
								new RowMapper<Object[]>() {
									@Override
									public Object[] mapRow(ResultSet rs, int rowNum) throws SQLException {
										final Object[] updateValues = new Object[3];
										updateValues[0] = expansion_factor_hectars;
										updateValues[1] = plot_weight;
										updateValues[2] = rs.getLong("_plot_id");										
										return updateValues;
									}
								});

						jdbcTemplate.batchUpdate("UPDATE " + schemaName + "plot SET expansion_factor=?, plot_weight=? WHERE _plot_id=?", sqlUpdateValues);
					} catch (NumberFormatException e) {
						logger.error("Possibly the header", e);
					} 

				}
			} catch (FileNotFoundException e) {
				logger.error("File not found?", e);
			} catch (IOException e) {
				logger.error("Error reading the CSV file", e);
			}

		}else{
			logger.warn("No CSV region_areas.csv present, calculating areas will not be possible");
		}

	}

	private void refreshDataSourceForSaiku() throws IOException {
		final File mdxFile = new File(getIdmFolder() + File.separatorChar + MDX_XML);

		Map<String, String> data = new HashMap<String, String>();
		data.put("cubeFilePath", mdxFile.getAbsolutePath().replace('\\', '/'));

		final File mdxTemplate = getMdxTemplate();
		final File dataSourceTemplate = getDataSourceTemplate(data);

		final File dataSourceFile = new File(getSaikuConfigurationFilePath());
		FreemarkerTemplateUtils.applyTemplate(dataSourceTemplate, dataSourceFile, data);

		setMdxSaikuSchema(mdxTemplate, mdxFile);
	}

	private File getMdxTemplate() throws IOException {
		final File mdxFileTemplate = new File(getIdmFolder() + File.separatorChar + MDX_TEMPLATE);
		if (!mdxFileTemplate.exists()) {
			throw new IOException("The file containing the MDX Cube definition Template does not exist in expected location " + mdxFileTemplate.getAbsolutePath());
		}
		return mdxFileTemplate;
	}

	private File getDataSourceTemplate(Map<String, String> data) throws IOException {
		File dataSourceTemplate = null;

		if( localPropertiesService.isUsingSqliteDB() ){
			dataSourceTemplate = new File(SQLITE_FREEMARKER_HTML_TEMPLATE);
			final File rdbDb = getRdbFile();
			if (!rdbDb.exists()) {
				throw new IOException("The file contianing the Relational SQLite Database does not exist in expected location " + rdbDb.getAbsolutePath());
			}
			data.put("rdbFilePath", rdbDb.getAbsolutePath().replace('\\', '/'));
		}else{
			dataSourceTemplate = new File(POSTGRESQL_FREEMARKER_HTML_TEMPLATE);
			data.put("dbUrl", ServerController.getSaikuDbURL() );
			data.put("username", localPropertiesService.getValue(EarthProperty.DB_USERNAME ));
			data.put("password", localPropertiesService.getValue(EarthProperty.DB_PASSWORD ));
		}

		if (!dataSourceTemplate.exists()) {
			throw new IOException("The file containing the Saiku Data Source template does not exist in expected location " + dataSourceTemplate.getAbsolutePath());
		}

		return dataSourceTemplate;
	}

	private void setMdxSaikuSchema(final File mdxFileTemplate, final File mdxFile ) throws IOException {
		Map<String, String> saikuData = new HashMap<String, String>();
		String saikuSchemaName = getSchemaName();
		if( saikuSchemaName==null){
			saikuSchemaName = "" ;
		}
		saikuData.put("saikuDbSchema", saikuSchemaName );
		FreemarkerTemplateUtils.applyTemplate(mdxFileTemplate, mdxFile, saikuData);
	}

	private void removeOldRdb() {

		final List<String> tables = new ArrayList<String>();

		if (localPropertiesService.isUsingSqliteDB()) {

			cleanSqlLiteDb(tables);

		} else if (localPropertiesService.isUsingPostgreSqlDB()) {
			cleanPostgresDb();

		}

	}

	private void runSaikuBat(String commandName) throws SaikuExecutionException {
		if (!isSaikuConfigured()) {
			throw new SaikuExecutionException("The Saiku server is not configured.");
		} else {
			String saikuCmd = getSaikuFolder() + File.separator + commandName + getCommandSuffix() ;
			
			if (SystemUtils.IS_OS_WINDOWS){
				saikuCmd = "\"" + saikuCmd  + "\"";
			}
			
			try {
				final ProcessBuilder builder = new ProcessBuilder(new String[] { saikuCmd });
				builder.directory(new File(getSaikuFolder()).getAbsoluteFile());
				builder.redirectErrorStream(true);
				builder.start();
			} catch (final IOException e) {
				logger.error("Error when running Saiku start/stop command", e);
			}
		}
	}

	private String getCommandSuffix() {
		if (SystemUtils.IS_OS_WINDOWS){
			
			return COMMAND_SUFFIX_BAT;
		}else{
			return COMMAND_SUFFIX_SH;
		}
	}

	public void setRefreshDatabase(boolean refreshDatabase) {
		this.refreshDatabase = refreshDatabase;
	}

	public void setUserCancelledOperation(boolean userCancelledOperation) {
		this.userCancelledOperation = userCancelledOperation;
	}

	private void startSaiku() throws SaikuExecutionException {
		logger.warn("Starting the Saiku server" + getSaikuFolder() + File.separator + START_SAIKU);

		runSaikuBat(START_SAIKU);

		logger.warn("Finished starting the Saiku server");
	}

	private void stopSaiku() throws SaikuExecutionException {
		logger.warn("Stoping the Saiku server" + getSaikuFolder() + File.separator + STOP_SAIKU);

		runSaikuBat(STOP_SAIKU);

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
