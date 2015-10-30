package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;

import net.lingala.zip4j.core.ZipFile;
import net.lingala.zip4j.exception.ZipException;

import org.apache.commons.codec.binary.Hex;
import org.apache.commons.dbcp.BasicDataSource;
import org.apache.commons.lang3.StringEscapeUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.SystemUtils;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.ad_hoc.AluToolUtils;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.model.AspectCode;
import org.openforis.collect.earth.app.model.DynamicsCode;
import org.openforis.collect.earth.app.model.SlopeCode;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.core.rdb.RelationalSchemaContext;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
import org.openforis.collect.relational.model.RelationalSchemaConfig;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NodeDefinitionVerifier;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import au.com.bytecode.opencsv.CSVReader;
import freemarker.template.TemplateException;

@Component
public class AnalysisSaikuService {

	private static final String ALU_CLIMATE_ZONE_CODE = "alu_climate_zone_code"; //$NON-NLS-1$

	private static final String ALU_SOIL_TYPE_CODE = "alu_soil_type_code"; //$NON-NLS-1$

	private static final String ALU_SUBCLASS_CODE = "alu_subclass_code"; //$NON-NLS-1$

	private static final String DYNAMICS_ID = "dynamics_id"; //$NON-NLS-1$

	private static final String ELEVATION_ID = "elevation_id"; //$NON-NLS-1$

	private static final String SLOPE_ID = "slope_id"; //$NON-NLS-1$

	private static final String ASPECT_ID = "aspect_id"; //$NON-NLS-1$

	private static final String START_SAIKU = "start-saiku"; //$NON-NLS-1$

	private static final String STOP_SAIKU = "stop-saiku"; //$NON-NLS-1$

	private static final String COMMAND_SUFFIX_BAT = ".bat"; //$NON-NLS-1$

	private static final String COMMAND_SUFFIX_SH = ".sh"; //$NON-NLS-1$

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

	@Autowired
	private RegionCalculationUtils regionCalculation;

	@Autowired
	private SchemaService schemaNamingService;

	private JdbcTemplate jdbcTemplate;

	private final Logger logger = LoggerFactory.getLogger(AnalysisSaikuService.class);

	private static final int ELEVATION_RANGE = 100;

	private RemoteWebDriver saikuWebDriver;

	private boolean refreshDatabase;

	private static final String SQLITE_FREEMARKER_HTML_TEMPLATE = "resources" + File.separator + "collectEarthSqliteDS.fmt"; //$NON-NLS-1$ //$NON-NLS-2$
	private static final String POSTGRESQL_FREEMARKER_HTML_TEMPLATE = "resources" + File.separator + "collectEarthPostgreSqlDS.fmt"; //$NON-NLS-1$ //$NON-NLS-2$
	private static final String MDX_XML = "collectEarthCubes.xml"; //$NON-NLS-1$
	private static final String MDX_TEMPLATE = MDX_XML + ".fmt"; //$NON-NLS-1$

	private boolean userCancelledOperation = false;
	private boolean saikuStarted;

	private void assignDimensionValues() {
		try {
			final String schemaName = getSchemaPrefix();
			// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
			final List<Object[]> sqlUpdateValues = jdbcTemplate.query("SELECT "+EarthConstants.PLOT_ID+", elevation, slope, aspect FROM " + schemaName + "plot", //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					new RowMapper<Object[]>() {
						@Override
						public Object[] mapRow(ResultSet rs, int rowNum) throws SQLException {

							final Object[] updateValues = new Object[4];

							Integer aspect = AspectCode.NA.getId();
							if (AspectCode.getAspectCode(rs.getDouble("aspect")) != null) { //$NON-NLS-1$
								aspect = AspectCode.getAspectCode(rs.getDouble("aspect")).getId(); //$NON-NLS-1$
							}

							Integer slope = SlopeCode.NA.getId();

							if (SlopeCode.getSlopeCode((int) rs.getFloat("slope")) != null) { //$NON-NLS-1$
								slope = SlopeCode.getSlopeCode((int) rs.getFloat("slope")).getId(); //$NON-NLS-1$
							}

							updateValues[0] = aspect;
							updateValues[1] = slope;
							updateValues[2] = Math.floor((int) rs.getFloat("elevation") / ELEVATION_RANGE) + 1; // 0 meters is bucket 1 ( id); //$NON-NLS-1$
							updateValues[3] = rs.getLong(EarthConstants.PLOT_ID);
							return updateValues;
						}

					});

			jdbcTemplate.batchUpdate("UPDATE " + schemaName + "plot SET " + ASPECT_ID +"=?," + SLOPE_ID + "=?,"+ ELEVATION_ID+"=? WHERE "+EarthConstants.PLOT_ID+"=?", sqlUpdateValues); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$
		} catch (DataAccessException e) {
			logger.error("No DEM information", e); //$NON-NLS-1$
		}
	}

	private String getSchemaPrefix() {
		return schemaNamingService.getSchemaPrefix();
	}

	private void assignPngAluToolDimensionValues() {
		try {
			if (earthSurveyService.getCollectSurvey().getName().toLowerCase().contains("png") ){  //$NON-NLS-1$
				final String schemaName = getSchemaPrefix();
				// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
				final List<Object[]> sqlUpdateValues = jdbcTemplate.query("SELECT "+EarthConstants.PLOT_ID+", elevation, soil_fundamental, land_use_subcategory, precipitation_ranges FROM " + schemaName + "plot LEFT JOIN " + schemaName + "precipitation_ranges_code where " //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
						+ "plot.annual_precipitation_code_id=precipitation_ranges_code.precipitation_ranges_code_id", //$NON-NLS-1$
						new RowMapper<Object[]>() {
							@Override
							public Object[] mapRow(ResultSet rs, int rowNum) throws SQLException {

								final Object[] updateValues = new Object[3];

								try {
									AluToolUtils aluToolUtils = new AluToolUtils();

									Integer elevation = rs.getInt("elevation"); //$NON-NLS-1$
									String soilFundamental = rs.getString("soil_fundamental"); //$NON-NLS-1$
									String precipitationRange = rs.getString("precipitation_ranges"); //$NON-NLS-1$


									int precipitation = -1;
									String climate_zone = "Unknown"; //$NON-NLS-1$
									if( precipitationRange != null ){
										precipitation = aluToolUtils.getPrecipitationFromRange(precipitationRange);
										boolean shortDrySeason = true; // According to information from Abe PNG has less than 5 months of dry season
										climate_zone = aluToolUtils.getClimateZone(elevation, precipitation, shortDrySeason );
									}								

									String soil_type = "Unknown"; //$NON-NLS-1$
									if( soilFundamental!=null){
										soil_type = aluToolUtils.getSoilType( soilFundamental );
									}


									updateValues[0] = climate_zone;
									updateValues[1] = soil_type;
									updateValues[2] = rs.getLong(EarthConstants.PLOT_ID);
								} catch (Exception e) {
									logger.error("Error while processing the data", e); //$NON-NLS-1$
									updateValues[0] = "Unknown"; //$NON-NLS-1$
									updateValues[1] = "Unknown"; //$NON-NLS-1$
									updateValues[2] = "Unknown"; //$NON-NLS-1$
									updateValues[0] = rs.getLong(EarthConstants.PLOT_ID);
								}
								return updateValues;
							}

						});

				jdbcTemplate.batchUpdate("UPDATE " + schemaName + "plot SET " + ALU_CLIMATE_ZONE_CODE +"=?," + ALU_SOIL_TYPE_CODE + "=? WHERE "+EarthConstants.PLOT_ID+"=?", sqlUpdateValues); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$
			}
		} catch (Exception e) {
			logger.error("No PNG ALU information", e); //$NON-NLS-1$
		}
	}

	private void assignLUCDimensionValues() {
		try {
			final String schemaName = getSchemaPrefix();
			// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
			final List<Object[]> sqlUpdateValues = jdbcTemplate.query("SELECT "+EarthConstants.PLOT_ID+", land_use_subcategory FROM " + schemaName + "plot", //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					new RowMapper<Object[]>() {
						@Override
						public Object[] mapRow(ResultSet rs, int rowNum) throws SQLException {

							AluToolUtils aluToolUtils = new AluToolUtils();
							final Object[] updateValues = new Object[3];

							String collectEarthSubcategory = rs.getString("land_use_subcategory"); //$NON-NLS-1$
							Integer dynamics = DynamicsCode.getDynamicsCode( collectEarthSubcategory); //$NON-NLS-1$
							String sub_class = "Unknown"; //$NON-NLS-1$
							if( collectEarthSubcategory != null ){
								sub_class = aluToolUtils.getAluSubclass(collectEarthSubcategory);
							}

							updateValues[0] = dynamics;
							updateValues[1] = sub_class;
							updateValues[2] = rs.getLong(EarthConstants.PLOT_ID);
							return updateValues;
						}

					});

			jdbcTemplate.batchUpdate("UPDATE " + schemaName + "plot SET " + DYNAMICS_ID +"=?,"+ ALU_SUBCLASS_CODE+"=? WHERE "+EarthConstants.PLOT_ID+"=?", sqlUpdateValues); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		} catch (Exception e) {
			logger.error("No PNG Alu information available", e); //$NON-NLS-1$
		}
	}

	private void cleanPostgresDb() {
		jdbcTemplate.execute("DROP SCHEMA IF EXISTS " + EarthConstants.POSTGRES_RDB_SCHEMA + " CASCADE"); //$NON-NLS-1$ //$NON-NLS-2$
		jdbcTemplate.execute("CREATE SCHEMA IF NOT EXISTS " + EarthConstants.POSTGRES_RDB_SCHEMA); //$NON-NLS-1$
	}

	private void cleanSqlLiteDb(final List<String> tables) {
		final File oldRdbFile = getRdbFile();
		if(oldRdbFile.exists() ){
			// We need to delete all tables before we can remove the file and drop the connection
			final List<Map<String, Object>> listOfTables = jdbcTemplate.queryForList("SELECT name FROM sqlite_master WHERE type='table';"); //$NON-NLS-1$
			for (final Map<String, Object> entry : listOfTables) {
				final String tableName = (String) entry.get("name"); //$NON-NLS-1$
				if (!tableName.equals("sqlite_sequence")) { //$NON-NLS-1$
					tables.add(tableName);
				}
			}

			for (final String tableName : tables) {
				jdbcTemplate.execute("DROP TABLE IF EXISTS " + tableName); //$NON-NLS-1$
			}


			// Now we can remove the SQLite file so that a completely new connection is open
			oldRdbFile.delete();

			if (!SystemUtils.IS_OS_WINDOWS){
				try {
					Thread.yield();
					Thread.sleep( 10000 );
				} catch (InterruptedException e) {
					logger.error("Error while giving pass to other processes", e);
				}
			}

			logger.warn("The sqlite database has been removed : " + oldRdbFile.getAbsolutePath() ); //$NON-NLS-1$
		}

	}

	private void createAspectAuxTable() {
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("CREATE TABLE " + schemaName + "aspect_category (" + ASPECT_ID + " INTEGER PRIMARY KEY, aspect_caption TEXT);"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		final AspectCode[] aspects = AspectCode.values();
		for (final AspectCode aspectCode : aspects) {
			jdbcTemplate
			.execute("INSERT INTO " + schemaName + "aspect_category values (" + aspectCode.getId() + ", '" + aspectCode.getLabel() + "')"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		}
	}

	private void createElevationtAuxTable() {
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("CREATE TABLE " + schemaName + "elevation_category ( " + ELEVATION_ID + " INTEGER PRIMARY KEY, elevation_caption TEXT);"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		final int slots = (int) Math.ceil(9000 / ELEVATION_RANGE); // Highest mountain in the world, mount everest is 8820m high
		for (int i = 1; i <= slots; i++) {
			jdbcTemplate.execute("INSERT INTO " + schemaName + "elevation_category values (" + i + ", '" + ((i - 1) * ELEVATION_RANGE) + "-" + i //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
					* ELEVATION_RANGE + "')"); //$NON-NLS-1$
		}

	}

	private void createDynamicsAuxTable() {
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("CREATE TABLE " + schemaName + "dynamics_category (" + DYNAMICS_ID + " INTEGER PRIMARY KEY, dynamics_caption TEXT);"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		final DynamicsCode[] dynamicsCodes = DynamicsCode.values();
		for (final DynamicsCode dynamicsCode : dynamicsCodes) {
			jdbcTemplate
			.execute("INSERT INTO " + schemaName + "dynamics_category values (" + dynamicsCode.getId() + ", '" + dynamicsCode.getLabel() + "')"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		}
	}

	private void createPlotForeignKeys() {
		// Add aspect_id column to plot
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD " + ASPECT_ID + " INTEGER"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD " + SLOPE_ID + " INTEGER"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD " + ELEVATION_ID + " INTEGER"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD " + DYNAMICS_ID + " INTEGER"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
	}




	private void createPngAluVariables(){
		if (earthSurveyService.getCollectSurvey().getName().toLowerCase().contains("png") ){  //$NON-NLS-1$
			final String schemaName = getSchemaPrefix();
			jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD "+ALU_SOIL_TYPE_CODE+" VARCHAR(5)"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD "+ALU_CLIMATE_ZONE_CODE+" VARCHAR(5)"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		}
	}

	private void creatAluSubclassVariables(){
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD "+ALU_SUBCLASS_CODE+" VARCHAR(5)"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
	}


	private void createSlopeAuxTable() {
		final String schemaName = getSchemaPrefix();
		// Slope can be from 0 to 90
		jdbcTemplate.execute("CREATE TABLE " + schemaName + "slope_category (slope_id INTEGER PRIMARY KEY, slope_caption TEXT);"); //$NON-NLS-1$ //$NON-NLS-2$
		final SlopeCode[] slopeCodes = SlopeCode.values();
		for (final SlopeCode slopeCode : slopeCodes) {
			jdbcTemplate.execute("INSERT INTO " + schemaName + "slope_category values (" + slopeCode.getId() + ", '" + slopeCode.getLabel() + "')"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		}
	}


	private String getRdbFilePrefix(){
		String result = "";
		try {
			final MessageDigest messageDigest = MessageDigest.getInstance("MD5");
			messageDigest.reset();
			String concatenation = earthSurveyService.getCollectSurvey().getUri() + earthSurveyService.getCollectSurvey().getName();
			messageDigest.update(concatenation.getBytes(Charset.forName("UTF8")));
			final byte[] resultByte = messageDigest.digest();
			result = new String(Hex.encodeHex(resultByte));
		} catch (NoSuchAlgorithmException e) {
			logger.error("Problems getting the MD5 hash of the project name", e);
		}
		return result;
	}

	private File getZippedSaikuProjectDB() {

		File saikuFolder = new File(FolderFinder.getLocalFolder() + File.separator + "saikuDatabase");

		if ( !saikuFolder.exists() ){
			saikuFolder.mkdir();
		}

		return new File(saikuFolder.getAbsolutePath() + File.separator + getRdbFilePrefix() +  ServerController.SAIKU_RDB_SUFFIX + ".zip");
	}

	public boolean isRdbFilePresent(){
		File rdbFile = getZippedSaikuProjectDB();

		return ( rdbFile!=null && rdbFile.exists() );
	}

	private boolean restoreProjectSaikuDB(){
		boolean restoredSaiku = false;
		if( getZippedSaikuProjectDB().exists() ){
			// Unzip file

			try {
				ZipFile zippedProjectSaikuData = new ZipFile( getZippedSaikuProjectDB() );
				zippedProjectSaikuData.extractAll( FolderFinder.getLocalFolder() );
				restoredSaiku = true;
			} catch (ZipException e) {
				logger.error("Problems unzipping the contents of the zipped Saiku DB to the local user folder ", e);
			}

		}
		return restoredSaiku;
	}

	private File getRdbFile() {

		return new File(COLLECT_EARTH_DATABASE_RDB_DB);

	}

	private String getSaikuConfigurationFilePath() {

		String configFile = getSaikuFolder() + "/" + "tomcat/webapps/saiku/WEB-INF/classes/saiku-datasources/collectEarthDS"; //$NON-NLS-1$ //$NON-NLS-2$
		configFile = configFile.replace('/', File.separatorChar);
		return configFile;
	}

	private String getSaikuThreeConfigurationFilePath() {

		String configFile = getSaikuFolder() + "/" + "tomcat/webapps/saiku/WEB-INF/classes/legacy-datasources/collectEarthDS"; //$NON-NLS-1$ //$NON-NLS-2$
		configFile = configFile.replace('/', File.separatorChar);
		return configFile;
	}

	private String getSaikuFolder() {
		final String configuredSaikuFolder = localPropertiesService.convertToOSPath( localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER) );
		if (StringUtils.isBlank(configuredSaikuFolder)) {
			return ""; //$NON-NLS-1$
		} else {
			final File saikuFolder = new File(configuredSaikuFolder);
			return saikuFolder.getAbsolutePath();
		}
	}

	@PostConstruct
	public void initialize() {
		jdbcTemplate = new JdbcTemplate(rdbDataSource);
	}

	@PreDestroy
	public void destroy(){
		try {
			stopSaiku();
		} catch (SaikuExecutionException e) {
			logger.error("Error while trying to quite Saiku before destroying the bean", e); //$NON-NLS-1$
		}
	}

	private boolean isRefreshDatabase() {
		return refreshDatabase;
	}

	private boolean isSaikuConfigured() {
		return getSaikuFolder() != null && isSaikuFolder(new File(getSaikuFolder()));
	}

	/*private boolean isJavaHomeConfigured() {

		if (SystemUtils.IS_OS_MAC){
			return true;
		}
		return ! ( 
				StringUtils.isBlank( System.getenv("JAVA_HOME") )  //$NON-NLS-1$
				&& 
				StringUtils.isBlank( System.getenv("JRE_HOME") ) //$NON-NLS-1$ 
				&& 
				StringUtils.isBlank( System.getenv("COLLECT_EARTH_JRE_HOME") )  //$NON-NLS-1$
				);
	}*/


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

	private void openSaiku() throws IOException, BrowserNotFoundException {
		saikuWebDriver = browserService.navigateTo("http://127.0.0.1:8181", saikuWebDriver,false); //$NON-NLS-1$
		browserService.waitFor("username", saikuWebDriver); //$NON-NLS-1$
		saikuWebDriver.findElementByName("username").sendKeys("admin"); //$NON-NLS-1$ //$NON-NLS-2$
		saikuWebDriver.findElementByName("password").sendKeys("admin"); //$NON-NLS-1$ //$NON-NLS-2$
		saikuWebDriver.findElementByClassName("form_button").click(); //$NON-NLS-1$
	}

	public void prepareDataForAnalysis() throws SaikuExecutionException {

		try {

			stopSaiku();

			try {
				removeOldRdb();

				if (!getZippedSaikuProjectDB().exists() || isRefreshDatabase()) {
					// The user clicked on the option to refresh the database, or there is no previous copy of the Saiku DB
					// Generate the DB file
					exportDataToRDB();
					try {
						// Save the DB file in a zipped file to keep for the next usages
						replaceZippedSaikuProjectDB();
					} catch (ZipException e) {
						logger.error("Error while refreshing the Zipped content of the project Saiku DB", e);
					}

				}else if( getZippedSaikuProjectDB().exists() ){
					// If the zipped version of the project exists ( and the user clicked on the option to not refresh it) then restore this last version of the data 
					restoreProjectSaikuDB();
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
								logger.error("Error opening the Saiku interface", e); //$NON-NLS-1$
							} catch (BrowserNotFoundException e) {
								logger.error("No browser has been set up", e); //$NON-NLS-1$
							}
						};
					}.start();

					stopSaikuOnExit();
				}
			} catch (final IOException e) {
				logger.error("Error while producing Relational DB from Collect format", e); //$NON-NLS-1$
			} catch (TemplateException e1) {
				logger.error("Error while applying the freemarker template tothe Saiku data source", e1); //$NON-NLS-1$
			}

		} catch (final CollectRdbException e) {
			logger.error("Error while producing Relational DB from Collect format", e); //$NON-NLS-1$
		}
	}

	private void replaceZippedSaikuProjectDB() throws ZipException {
		CollectEarthUtils.addFileToZip( 
				getZippedSaikuProjectDB().getAbsolutePath(),
				getRdbFile(), 
				getRdbFile().getName()
				);
	}

	public void exportDataToRDB() throws CollectRdbException {
		/*
		 * The SQLite DB has no limit on the length of the varchar.
		 * By default, if no RelationalSchemaConfig is passed to the export command text fields will be truncated to 255 characters
		 */
		final RelationalSchemaConfig rdbConfig = new RelationalSchemaContext().getRdbConfig();

		final String rdbSaikuSchema = getSchemaName();

		collectRDBPublisher.export(earthSurveyService.getCollectSurvey().getName(), EarthConstants.ROOT_ENTITY_NAME, Step.ENTRY,
				rdbSaikuSchema, rdbConfig);

		if (!isUserCancelledOperation()) {
			System.currentTimeMillis();
			try {
				processQuantityData();
				setSaikuAsDefaultSchema();
			} catch (final Exception e) {
				logger.error("Error processing quantity data", e); //$NON-NLS-1$
			}
		}
	}

	private String getSchemaName() {
		// TODO Auto-generated method stub
		return null;
	}

	private void setSaikuAsDefaultSchema() {
		if( localPropertiesService.isUsingPostgreSqlDB() ){
			jdbcTemplate.execute("SET search_path TO " + getSchemaName() ); //$NON-NLS-1$
		}
	}

	private void processQuantityData() throws SQLException {
		createPngAluVariables();

		createPlotForeignKeys();

		
		if( !surveyContains("calculated_elevation_range" , earthSurveyService.getCollectSurvey() ) ){
			createAspectAuxTable();

			createSlopeAuxTable();
			createElevationtAuxTable();
			assignDimensionValues();
		}

		if( !surveyContains("calculated_initial_land_use", earthSurveyService.getCollectSurvey() ) ){
			createDynamicsAuxTable();
			creatAluSubclassVariables();
			assignLUCDimensionValues();
		}
		
		assignPngAluToolDimensionValues();

		regionCalculation.handleRegionCalculation();

	}



	public static boolean surveyContains(String node_name, CollectSurvey survey) {
		NodeDefinition nodeDefForNAme = survey.getSchema().findNodeDefinition( new NodeDefinitionVerifier() {
			
			@Override
			public boolean verify(NodeDefinition nodeDef) {
				return nodeDef.getName().equals(node_name);
			}
		});
		return nodeDefForNAme != null;
	}

	public static CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8"))); //$NON-NLS-1$
		reader = new CSVReader(bufferedReader, ',');
		return reader;
	}



	private void refreshDataSourceForSaiku() throws IOException, TemplateException {
		final File mdxFile = new File( localPropertiesService.getProjectFolder() + File.separatorChar + MDX_XML);

		Map<String, String> data = new HashMap<String, String>();
		data.put("cubeFilePath", StringEscapeUtils.escapeJava( mdxFile.getAbsolutePath().replace('\\', '/')) ); //$NON-NLS-1$

		final File mdxTemplate = getMdxTemplate();
		final File dataSourceTemplate = getDataSourceTemplate(data);

		// First try Saiku 2.5/2.6
		File dataSourceFile;
		try {
			dataSourceFile = new File(getSaikuConfigurationFilePath());
			FreemarkerTemplateUtils.applyTemplate(dataSourceTemplate, dataSourceFile, data);
		} catch (Exception e) {
			System.out.println("Saiku datasources file not found, testing witht the directory for the 3.0 datasources "); //$NON-NLS-1$
			logger.error("Error starting Saiku", e);
			dataSourceFile = new File(getSaikuThreeConfigurationFilePath());
			FreemarkerTemplateUtils.applyTemplate(dataSourceTemplate, dataSourceFile, data);
		}


		setMdxSaikuSchema(mdxTemplate, mdxFile);
	}

	private File getMdxTemplate() throws IOException {
		final File mdxFileTemplate = new File( localPropertiesService.getProjectFolder() + File.separatorChar + MDX_TEMPLATE);
		if (!mdxFileTemplate.exists()) {
			throw new IOException("The file containing the MDX Cube definition Template does not exist in expected location " + mdxFileTemplate.getAbsolutePath()); //$NON-NLS-1$
		}
		return mdxFileTemplate;
	}

	private File getDataSourceTemplate(Map<String, String> data) throws IOException {
		File dataSourceTemplate = null;



		if( localPropertiesService.isUsingSqliteDB() ){
			dataSourceTemplate = new File(SQLITE_FREEMARKER_HTML_TEMPLATE);
			final File rdbDb = getRdbFile();
			if (!rdbDb.exists()) {
				throw new IOException("The file contianing the Relational SQLite Database does not exist in expected location " + rdbDb.getAbsolutePath()); //$NON-NLS-1$
			}
			data.put("rdbFilePath", StringEscapeUtils.escapeJava( rdbDb.getAbsolutePath().replace('\\', '/') ) ); //$NON-NLS-1$
		}else{
			dataSourceTemplate = new File(POSTGRESQL_FREEMARKER_HTML_TEMPLATE);
			CollectDBDriver collectDBDriver = localPropertiesService.getCollectDBDriver();
			data.put("dbUrl", StringEscapeUtils.escapeJava( ServerController.getSaikuDbURL(collectDBDriver) ) ); //$NON-NLS-1$
			data.put("username", StringEscapeUtils.escapeJava( localPropertiesService.getValue(EarthProperty.DB_USERNAME ) ) ); //$NON-NLS-1$
			data.put("password", StringEscapeUtils.escapeJava( localPropertiesService.getValue(EarthProperty.DB_PASSWORD ) ) ); //$NON-NLS-1$
		}

		if (!dataSourceTemplate.exists()) {
			throw new IOException("The file containing the Saiku Data Source template does not exist in expected location " + dataSourceTemplate.getAbsolutePath()); //$NON-NLS-1$
		}

		return dataSourceTemplate;
	}

	private void setMdxSaikuSchema(final File mdxFileTemplate, final File mdxFile ) throws IOException, TemplateException {
		Map<String, String> saikuData = new HashMap<String, String>();
		String saikuSchemaName = getSchemaName();
		if( saikuSchemaName==null){
			saikuSchemaName = "" ; //$NON-NLS-1$
		}
		saikuData.put("saikuDbSchema", saikuSchemaName ); //$NON-NLS-1$
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
			throw new SaikuExecutionException("The Saiku server is not configured."); //$NON-NLS-1$
		} 
/*		Commented out : the Java Home variable is not necessary any more in order to run Saiku as the path to the Java Runtime Environment distributed with Collect Earth is hardcoded on the bat/sh files
		else if (!isJavaHomeConfigured()) {
			throw new SaikuExecutionException("The JAVA_HOME environment variable is not configured. JAVA_HOME must point to the root folder of a valid JDK."); //$NON-NLS-1$
		} */
		else {
			String saikuCmd = getSaikuFolder() + File.separator + commandName + getCommandSuffix() ;

			if (SystemUtils.IS_OS_WINDOWS){
				saikuCmd = "\"" + saikuCmd  + "\""; //$NON-NLS-1$ //$NON-NLS-2$
			}


			try {

				Process runSaiku = runProcessBuilder( new String[]{saikuCmd});

				if( commandName.equals( STOP_SAIKU )){
					int result = runSaiku.waitFor();
					logger.warn("Script ended with result " + result); //$NON-NLS-1$
				}else if ( commandName.equals( START_SAIKU ) ){
					Thread.sleep(6000);
				}



			} catch (final IOException e) {
				logger.error("Error when running Saiku start/stop command", e); //$NON-NLS-1$
			} catch (InterruptedException e) {
				logger.error("Error when running Saiku start/stop command", e); //$NON-NLS-1$
			}
		}
	}

	private void setMacJreHome( ProcessBuilder p ) {
		if( SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX  || SystemUtils.IS_OS_LINUX){

			File javaFolder = new File("./java");

			if( !javaFolder.exists() ){
				String userName = System.getProperty("user.name");
				String testWithPath = "/Users/"+userName + "/OpenForis/CollectEarth/java";
				File testJavaPath = new File(testWithPath);
				if( testJavaPath.exists()){
					javaFolder = testJavaPath;
				}
			}

			Map<String, String> environment = p.environment();
			environment.put("COLLECT_EARTH_JRE_HOME", javaFolder.getAbsolutePath());

			/*// In MAC the environment variable COLLECT_EARTH_JRE_HOME is not accesible from outside the bash, set it again!
		if( SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX){
			try {				
				File javaFolder = new File("./java");

				if( !javaFolder.exists() ){
					String userName = System.getProperty("user.name");
					String testWithPath = "/Users/"+userName + "/OpenForis/CollectEarth/java";
					File testJavaPath = new File(testWithPath);
					if( testJavaPath.exists()){
						javaFolder = testJavaPath;
					}
				}

				Process setEnv = runProcessBuilder(new String[] { "/bin/bash", "setenv", "COLLECT_EARTH_JRE_HOME=\""+ javaFolder.getAbsolutePath() +"\"" });
				setEnv.waitFor();
			} catch (final IOException e) {
				logger.error("Error setting the COLLECT_EARTH_JRE_HOME environment variable", e); //$NON-NLS-1$
			} catch (InterruptedException e) {
				logger.error("Error when running COLLECT_EARTH_JRE_HOME environment variable", e); //$NON-NLS-1$
			}
		}*/
		}
	}

	private Process runProcessBuilder(String[] cmd) throws IOException {
		final ProcessBuilder builder = new ProcessBuilder(cmd);
		
		// Fixes bug with Mac OS X not using the environemnt variable set for bash
		setMacJreHome(builder);
		
		builder.directory(new File(getSaikuFolder()).getAbsoluteFile());
		builder.redirectErrorStream(true);
		Process p = builder.start();
		(new ProcessLoggerThread(p.getInputStream()) ).start();
		(new ProcessLoggerThread(p.getErrorStream()) ).start();
		return p;
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
		logger.warn("Starting the Saiku server" + getSaikuFolder() + File.separator + START_SAIKU); //$NON-NLS-1$

		runSaikuBat(START_SAIKU);

		this.setSaikuStarted(true);

		logger.warn("Finished starting the Saiku server"); //$NON-NLS-1$
	}

	private void stopSaiku() throws SaikuExecutionException {
		logger.warn("Stoping the Saiku server" + getSaikuFolder() + File.separator + STOP_SAIKU); //$NON-NLS-1$
		if( isSaikuStarted() ){
			runSaikuBat(STOP_SAIKU);
			this.setSaikuStarted(true);
		}
		logger.warn("Finished stoping the Saiku server"); //$NON-NLS-1$
	}

	private void stopSaikuOnExit() {
		Runtime.getRuntime().addShutdownHook(new Thread() {
			@Override
			public void run() {
				try {
					if( isSaikuStarted() ){
						stopSaiku();
					}
				} catch (final SaikuExecutionException e) {
					logger.error("The Saiku server has been de-configured after it was started", e); //$NON-NLS-1$
				}
			}

		});
	}

	private boolean isSaikuStarted() {
		return saikuStarted;
	}

	private void setSaikuStarted(boolean saikuStarted) {
		this.saikuStarted = saikuStarted;
	}

}