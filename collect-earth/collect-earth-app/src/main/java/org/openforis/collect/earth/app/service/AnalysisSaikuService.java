package org.openforis.collect.earth.app.service;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.swing.SwingUtilities;

import org.apache.commons.lang3.SystemUtils;
import org.apache.commons.text.StringEscapeUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.ad_hoc.AluToolUtils;
import org.openforis.collect.earth.app.desktop.ServerController;
import org.openforis.collect.earth.app.model.AspectCode;
import org.openforis.collect.earth.app.model.DynamicsCode;
import org.openforis.collect.earth.app.model.SlopeCode;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.InfiniteProgressMonitor;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
import org.openforis.concurrency.Progress;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openqa.selenium.By;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import com.opencsv.CSVReader;

import freemarker.template.TemplateException;

@Component
public class AnalysisSaikuService extends GenerateDatabase implements DisposableBean{

	private static final String PLOT_ADD = "plot ADD ";

	private static final String UPDATE = "UPDATE ";

	private static final String UNKNOWN = "Unknown";

	private static final String VARCHAR_5 = " VARCHAR(5)";

	private static final String INTEGER = " INTEGER";

	private static final String ALTER_TABLE = "ALTER TABLE ";

	private static final String INSERT_INTO = "INSERT INTO ";

	private static final String CREATE_TABLE = "CREATE TABLE ";

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

	public static final String COLLECT_EARTH_DATABASE_RDB_DB = EarthConstants.COLLECT_EARTH_DATABASE_SQLITE_DB
			+ EarthConstants.SAIKU_RDB_SUFFIX;


	@Autowired
	RDBExporter rdbExporter;

	@Autowired
	CollectRDBPublisher collectRDBPublisher;

	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	public LocalPropertiesService localPropertiesService;

	@Autowired
	BrowserService browserService;

	@Autowired
	private RegionCalculationUtils regionCalculation;

	@Autowired
	private SchemaService schemaNamingService;
	
	private static final int ELEVATION_RANGE = 100;

	private RemoteWebDriver saikuWebDriver;

	private static final String SQLITE_FREEMARKER_HTML_TEMPLATE = "resources" + File.separator //$NON-NLS-1$
			+ "collectEarthSqliteDS.fmt"; //$NON-NLS-1$
	private static final String POSTGRESQL_FREEMARKER_HTML_TEMPLATE = "resources" + File.separator //$NON-NLS-1$
			+ "collectEarthPostgreSqlDS.fmt"; //$NON-NLS-1$
	public static final String MDX_XML = "collectEarthCubes.xml"; //$NON-NLS-1$
	private static final String MDX_TEMPLATE = MDX_XML + ".fmt"; //$NON-NLS-1$

	private boolean saikuStarted;

	private void assignDimensionValues() {
		try {
			final String schemaName = getSchemaPrefix();
			// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
			final List<Object[]> sqlUpdateValues = rdbExporter.getJdbcTemplate().query(
					"SELECT " + EarthConstants.PLOT_ID + ", elevation, slope, aspect FROM " + schemaName + "plot", //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
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
							updateValues[2] = ( (int) rs.getFloat("elevation") / ELEVATION_RANGE) + 1; // 0 //$NON-NLS-1$

							updateValues[3] = rs.getLong(EarthConstants.PLOT_ID);
							return updateValues;
						}

					});

			rdbExporter.getJdbcTemplate().batchUpdate(UPDATE + schemaName + "plot SET " + ASPECT_ID + "=?," + SLOPE_ID + "=?," //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
					+ ELEVATION_ID + "=? WHERE " + EarthConstants.PLOT_ID + "=?", sqlUpdateValues); //$NON-NLS-1$ //$NON-NLS-2$
		} catch (Exception e) {
			logger.warn("No DEM information", e); //$NON-NLS-1$
		}
	}

	private String getSchemaPrefix() {
		return schemaNamingService.getSchemaPrefix(ExportType.SAIKU);
	}

	private void assignPngAluToolDimensionValues() {
		try {
			if (earthSurveyService.getCollectSurvey().getName().toLowerCase().contains("png")) { //$NON-NLS-1$
				final String schemaName = getSchemaPrefix();
				// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
				final List<Object[]> sqlUpdateValues = rdbExporter.getJdbcTemplate().query(
						"SELECT " + EarthConstants.PLOT_ID //$NON-NLS-1$
						+ ", elevation, soil_fundamental, land_use_subcategory, precipitation_ranges FROM " + schemaName //$NON-NLS-1$
						+ "plot LEFT JOIN " + schemaName + "precipitation_ranges_code where " //$NON-NLS-1$ //$NON-NLS-2$
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
									String climateZone = UNKNOWN; //$NON-NLS-1$
									if (precipitationRange != null) {
										precipitation = aluToolUtils.getPrecipitationFromRange(precipitationRange);
										boolean shortDrySeason = true; // According to information from Abe PNG has less
																		// than 5 months of dry season
										climateZone = aluToolUtils.getClimateZone(elevation, precipitation,
												shortDrySeason);
									}

									String soilType = UNKNOWN; //$NON-NLS-1$
									if (soilFundamental != null) {
										soilType = aluToolUtils.getSoilType(soilFundamental);
									}

									updateValues[0] = climateZone;
									updateValues[1] = soilType;
									updateValues[2] = rs.getLong(EarthConstants.PLOT_ID);
								} catch (Exception e) {
									logger.error("Error while processing the data", e); //$NON-NLS-1$
									updateValues[0] = UNKNOWN; //$NON-NLS-1$
									updateValues[1] = UNKNOWN; //$NON-NLS-1$
									updateValues[2] = UNKNOWN; //$NON-NLS-1$
								}
								return updateValues;
							}

						});

				rdbExporter.getJdbcTemplate().batchUpdate(UPDATE + schemaName + "plot SET " + ALU_CLIMATE_ZONE_CODE + "=?," //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
						+ ALU_SOIL_TYPE_CODE + "=? WHERE " + EarthConstants.PLOT_ID + "=?", sqlUpdateValues); //$NON-NLS-1$ //$NON-NLS-2$
			}
		} catch (Exception e) {
			logger.error("No PNG ALU information", e); //$NON-NLS-1$
		}
	}

	private void assignLUCDimensionValues() {
		try {
			final String schemaName = getSchemaPrefix();
			// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
			final List<Object[]> sqlUpdateValues = rdbExporter.getJdbcTemplate().query(
					"SELECT " + EarthConstants.PLOT_ID + ", land_use_subcategory FROM " + schemaName + "plot", //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					new RowMapper<Object[]>() {
						@Override
						public Object[] mapRow(ResultSet rs, int rowNum) throws SQLException {

							AluToolUtils aluToolUtils = new AluToolUtils();
							final Object[] updateValues = new Object[3];

							String collectEarthSubcategory = rs.getString("land_use_subcategory"); //$NON-NLS-1$
							Integer dynamics = DynamicsCode.getDynamicsCode(collectEarthSubcategory);
							String subClass = UNKNOWN; //$NON-NLS-1$
							if (collectEarthSubcategory != null) {
								subClass = aluToolUtils.getAluSubclass(collectEarthSubcategory);
							}

							updateValues[0] = dynamics;
							updateValues[1] = subClass;
							updateValues[2] = rs.getLong(EarthConstants.PLOT_ID);
							return updateValues;
						}

					});

			rdbExporter.getJdbcTemplate().batchUpdate(UPDATE + schemaName + "plot SET " + DYNAMICS_ID + "=?," + ALU_SUBCLASS_CODE //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					+ "=? WHERE " + EarthConstants.PLOT_ID + "=?", sqlUpdateValues); //$NON-NLS-1$
		} catch (Exception e) {
			logger.warn("No PNG Alu information available", e); //$NON-NLS-1$
		}
	}

	private void createAspectAuxTable() {
		final String schemaName = getSchemaPrefix();
		rdbExporter.getJdbcTemplate().execute(CREATE_TABLE + schemaName + "aspect_category (" + ASPECT_ID //$NON-NLS-1$ //$NON-NLS-2$
				+ " INTEGER PRIMARY KEY, aspect_caption TEXT);"); //$NON-NLS-1$
		final AspectCode[] aspects = AspectCode.values();
		for (final AspectCode aspectCode : aspects) {
			rdbExporter.getJdbcTemplate().execute(INSERT_INTO + schemaName + "aspect_category values (" + aspectCode.getId() + ", '" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					+ aspectCode.getLabel() + "')"); //$NON-NLS-1$
		}
	}

	private void createElevationtAuxTable() {
		final String schemaName = getSchemaPrefix();
		rdbExporter.getJdbcTemplate().execute(CREATE_TABLE + schemaName + "elevation_category ( " + ELEVATION_ID //$NON-NLS-1$ //$NON-NLS-2$
				+ " INTEGER PRIMARY KEY, elevation_caption TEXT);"); //$NON-NLS-1$
		final int slots = 9000 / ELEVATION_RANGE; // Highest mountain in the world, mount everest is
																	// 8820m high
		for (int i = 1; i <= slots; i++) {
			rdbExporter.getJdbcTemplate().execute(INSERT_INTO + schemaName + "elevation_category values (" + i + ", '" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					+ ((i - 1) * ELEVATION_RANGE) + "-" + i //$NON-NLS-1$
							* ELEVATION_RANGE
					+ "')"); //$NON-NLS-1$
		}

	}

	private void createDynamicsAuxTable() {
		final String schemaName = getSchemaPrefix();
		rdbExporter.getJdbcTemplate().execute(CREATE_TABLE + schemaName + "dynamics_category (" + DYNAMICS_ID //$NON-NLS-1$ //$NON-NLS-2$
				+ " INTEGER PRIMARY KEY, dynamics_caption TEXT);"); //$NON-NLS-1$
		final DynamicsCode[] dynamicsCodes = DynamicsCode.values();
		for (final DynamicsCode dynamicsCode : dynamicsCodes) {
			rdbExporter.getJdbcTemplate().execute(INSERT_INTO + schemaName + "dynamics_category values (" + dynamicsCode.getId() //$NON-NLS-1$ //$NON-NLS-2$
					+ ", '" + dynamicsCode.getLabel() + "')"); //$NON-NLS-1$ //$NON-NLS-2$
		}
	}

	private void createPlotForeignKeys() {
		// Add aspect_id column to plot
		final String schemaName = getSchemaPrefix();
		rdbExporter.getJdbcTemplate().execute(ALTER_TABLE + schemaName + PLOT_ADD + ASPECT_ID + INTEGER); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		rdbExporter.getJdbcTemplate().execute(ALTER_TABLE + schemaName + PLOT_ADD + SLOPE_ID + INTEGER); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		rdbExporter.getJdbcTemplate().execute(ALTER_TABLE + schemaName + PLOT_ADD + ELEVATION_ID + INTEGER); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		rdbExporter.getJdbcTemplate().execute(ALTER_TABLE + schemaName + PLOT_ADD + DYNAMICS_ID + INTEGER); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
	}

	private void createPngAluVariables() {
		if (earthSurveyService.getCollectSurvey().getName().toLowerCase().contains("png")) { //$NON-NLS-1$
			final String schemaName = getSchemaPrefix();
			rdbExporter.getJdbcTemplate().execute(ALTER_TABLE + schemaName + PLOT_ADD + ALU_SOIL_TYPE_CODE + VARCHAR_5); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			rdbExporter.getJdbcTemplate().execute(ALTER_TABLE + schemaName + PLOT_ADD + ALU_CLIMATE_ZONE_CODE + VARCHAR_5); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		}
	}

	private void creatAluSubclassVariables() {
		final String schemaName = getSchemaPrefix();
		rdbExporter.getJdbcTemplate().execute(ALTER_TABLE + schemaName + PLOT_ADD + ALU_SUBCLASS_CODE + VARCHAR_5); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
	}

	private void createSlopeAuxTable() {
		final String schemaName = getSchemaPrefix();
		// Slope can be from 0 to 90
		rdbExporter.getJdbcTemplate().execute(
				CREATE_TABLE + schemaName + "slope_category (slope_id INTEGER PRIMARY KEY, slope_caption TEXT);"); //$NON-NLS-1$ //$NON-NLS-2$
		final SlopeCode[] slopeCodes = SlopeCode.values();
		for (final SlopeCode slopeCode : slopeCodes) {
			rdbExporter.getJdbcTemplate().execute(INSERT_INTO + schemaName + "slope_category values (" + slopeCode.getId() + ", '" //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					+ slopeCode.getLabel() + "')"); //$NON-NLS-1$
		}
	}

	private String getSaikuConfigurationFilePath() {

		String configFile = localPropertiesService.getSaikuFolder() + "/" //$NON-NLS-1$
				+ "tomcat/webapps/saiku/WEB-INF/classes/saiku-datasources/collectEarthDS"; //$NON-NLS-1$
		configFile = configFile.replace('/', File.separatorChar);
		return configFile;
	}

	private String getSaikuThreeConfigurationFilePath() {

		String configFile = localPropertiesService.getSaikuFolder() + "/" //$NON-NLS-1$
				+ "tomcat/webapps/saiku/WEB-INF/classes/legacy-datasources/collectEarthDS"; //$NON-NLS-1$
		configFile = configFile.replace('/', File.separatorChar);
		return configFile;
	}

	private boolean isSaikuConfigured() {
		return localPropertiesService.getSaikuFolder() != null
				&& isSaikuFolder(new File(localPropertiesService.getSaikuFolder()));
	}

	/*
	 * private boolean isJavaHomeConfigured() {
	 *
	 * if (SystemUtils.IS_OS_MAC){ return true; } return ! ( StringUtils.isBlank(
	 * System.getenv("JAVA_HOME") ) //$NON-NLS-1$ && StringUtils.isBlank(
	 * System.getenv("JRE_HOME") ) //$NON-NLS-1$ && StringUtils.isBlank(
	 * System.getenv("COLLECT_EARTH_JRE_HOME") ) //$NON-NLS-1$ ); }
	 */

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

	private void openSaiku() throws BrowserNotFoundException {
		saikuWebDriver = browserService.navigateTo("http://127.0.0.1:8181", saikuWebDriver, false); //$NON-NLS-1$
		if (browserService.waitFor("username", saikuWebDriver)) { //$NON-NLS-1$
			saikuWebDriver.findElement(By.name("username") ).sendKeys("admin"); //$NON-NLS-1$ //$NON-NLS-2$
			saikuWebDriver.findElement(By.name("password") ).sendKeys("admin"); //$NON-NLS-1$ //$NON-NLS-2$
			saikuWebDriver.findElement(By.className("form_button") ).click(); //$NON-NLS-1$
		}
	}


	public void prepareDataForAnalysis(InfiniteProgressMonitor progressListener, boolean startSaikuAfterDBExport) throws SaikuExecutionException {

		try {

			stopSaiku();

			try {

				if ((localPropertiesService.isUsingSqliteDB() && !getZippedProjectDB( ExportType.SAIKU ).exists())
						|| isRefreshDatabase()) {
					
					// The user clicked on the option to refresh the database, or there is no
					// previous copy of the Saiku DB
					// Generate the DB file
					rdbExporter.exportDataToRDB(
							earthSurveyService.getCollectSurvey(), 
							ExportType.SAIKU, 
							progressListener, 
							this::processQuantityData
						);
			
					try {
						// Save the DB file in a zipped file to extends GenerateDatabase keep for the next usages
						replaceZippedProjectDB( ExportType.SAIKU );
					} catch (Exception e) {
						logger.error("Error while refreshing the Zipped content of the project Saiku DB", e);
					}

				} else if (getZippedProjectDB(ExportType.SAIKU).exists() && localPropertiesService.isUsingSqliteDB()) {
					// If the zipped version of the project exists ( and the user clicked on the
					// option to not refresh it) then restore this last version of the data
						restoreZippedProjectDB(ExportType.SAIKU);
				}

				refreshDataSourceForSaiku();

				if (startSaikuAfterDBExport && !isUserCancelledOperation()) {
					startSaiku();
					new Thread("Opening Saiku") {
						@Override
						public void run() {
							try {
								AnalysisSaikuService.this.openSaiku();
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

	private void processQuantityData(InfiniteProgressMonitor progressListener) {

		SwingUtilities.invokeLater( () ->  progressListener.setMessage("Preparing Saiku data for analysis") );

		progressListener.progressMade(new Progress(0, 100));
		createPngAluVariables();
		createPlotForeignKeys();

		progressListener.progressMade(new Progress(25, 100));

		if (!surveyContains("calculated_elevation_range", earthSurveyService.getCollectSurvey())) {
			createAspectAuxTable();
			createSlopeAuxTable();
			createElevationtAuxTable();
			assignDimensionValues();

		}
		progressListener.progressMade(new Progress(50, 100));

		if (!surveyContains("calculated_initial_land_use", earthSurveyService.getCollectSurvey())) {
			createDynamicsAuxTable();
			creatAluSubclassVariables();
			assignLUCDimensionValues();

		}
		progressListener.progressMade(new Progress(75, 100));

		assignPngAluToolDimensionValues();

		SwingUtilities.invokeLater( () -> progressListener.setMessage("Calculating expansion factors") );

		regionCalculation.handleRegionCalculation( ExportType.SAIKU, rdbExporter.getJdbcTemplate() );
		progressListener.progressMade(new Progress(100, 100));

	}

	public static boolean surveyContains(String nodeName, CollectSurvey survey) {
		NodeDefinition nodeDefForNAme = survey.getSchema().findNodeDefinition( nodeDef -> nodeDef.getName().equals(nodeName) );
		return nodeDefForNAme != null;
	}

	public static CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		final BufferedReader bufferedReader = new BufferedReader(
				new InputStreamReader(new FileInputStream(csvFile), StandardCharsets.UTF_8 ) ); //$NON-NLS-1$
		return new CSVReader(bufferedReader);
	}

	private void refreshDataSourceForSaiku() throws IOException, TemplateException {
		final File mdxFile = new File(localPropertiesService.getProjectFolder() + File.separatorChar + MDX_XML);

		Map<String, String> data = new HashMap<>();
		data.put("cubeFilePath", StringEscapeUtils.escapeJava(mdxFile.getAbsolutePath().replace('\\', '/'))); //$NON-NLS-1$

		final File mdxTemplate = getMdxTemplate();
		final File dataSourceTemplate = getDataSourceTemplate(data);

		// First try Saiku 2.5/2.6
		File dataSourceFile;
		try {
			dataSourceFile = new File(getSaikuConfigurationFilePath());
			FreemarkerTemplateUtils.applyTemplate(dataSourceTemplate, dataSourceFile, data);
		} catch (Exception e) {
			logger.error("Error starting Saiku", e);
			dataSourceFile = new File(getSaikuThreeConfigurationFilePath());
			FreemarkerTemplateUtils.applyTemplate(dataSourceTemplate, dataSourceFile, data);
		}

		setMdxSaikuSchema(mdxTemplate, mdxFile);
	}

	private File getMdxTemplate() throws IOException {
		final File mdxFileTemplate = new File(
				localPropertiesService.getProjectFolder() + File.separatorChar + MDX_TEMPLATE);
		if (!mdxFileTemplate.exists()) {
			throw new IOException(
					"The file containing the MDX Cube definition Template does not exist in expected location " //$NON-NLS-1$
							+ mdxFileTemplate.getAbsolutePath());
		}
		return mdxFileTemplate;
	}

	private File getDataSourceTemplate(Map<String, String> data) throws IOException {
		File dataSourceTemplate = null;

		if (localPropertiesService.isUsingSqliteDB()) {
			dataSourceTemplate = new File(SQLITE_FREEMARKER_HTML_TEMPLATE);
			final File rdbDb = rdbExporter.getRdbFile( ExportType.SAIKU );
			if (!rdbDb.exists()) {
				throw new IOException(
						"The file contianing the Relational SQLite Database does not exist in expected location " //$NON-NLS-1$
								+ rdbDb.getAbsolutePath());
			}
			data.put("rdbFilePath", StringEscapeUtils.escapeJava(rdbDb.getAbsolutePath().replace('\\', '/'))); //$NON-NLS-1$
		} else {
			dataSourceTemplate = new File(POSTGRESQL_FREEMARKER_HTML_TEMPLATE);
			CollectDBDriver collectDBDriver = localPropertiesService.getCollectDBDriver();
			data.put("dbUrl", StringEscapeUtils.escapeJava(ServerController.getSaikuDbURL(collectDBDriver))); //$NON-NLS-1$
			data.put("username", //$NON-NLS-1$
					StringEscapeUtils.escapeJava(localPropertiesService.getValue(EarthProperty.DB_USERNAME)));
			data.put("password", //$NON-NLS-1$
					StringEscapeUtils.escapeJava(localPropertiesService.getValue(EarthProperty.DB_PASSWORD)));
		}

		if (!dataSourceTemplate.exists()) {
			throw new IOException(
					"The file containing the Saiku Data Source template does not exist in expected location " //$NON-NLS-1$
							+ dataSourceTemplate.getAbsolutePath());
		}

		return dataSourceTemplate;
	}

	private void setMdxSaikuSchema(final File mdxFileTemplate, final File mdxFile)
			throws IOException, TemplateException {
		Map<String, String> saikuData = new HashMap<>();
		String saikuSchemaName = getSchemaName();
		if (saikuSchemaName == null) {
			saikuSchemaName = ""; //$NON-NLS-1$
		}
		saikuData.put("saikuDbSchema", saikuSchemaName); //$NON-NLS-1$
		FreemarkerTemplateUtils.applyTemplate(mdxFileTemplate, mdxFile, saikuData);
	}

	private void runSaikuBat(String commandName) throws SaikuExecutionException {
		if (!isSaikuConfigured()) {
			throw new SaikuExecutionException("The Saiku server is not configured."); //$NON-NLS-1$
		}

		else {
			String saikuCmd = localPropertiesService.getSaikuFolder() + File.separator + commandName
					+ getCommandSuffix();

			if (SystemUtils.IS_OS_WINDOWS) {
				saikuCmd = "\"" + saikuCmd + "\""; //$NON-NLS-1$ //$NON-NLS-2$
			}

			try {

				Process runSaiku = runProcessBuilder(new String[] { saikuCmd });

				if (commandName.equals(STOP_SAIKU)) {
					int result = runSaiku.waitFor();
					logger.warn("Script ended with result {}", result); //$NON-NLS-1$
				} else if (commandName.equals(START_SAIKU)) {
					Thread.sleep(6000);
				}

			} catch (final IOException e) {
				logger.error("Error when running Saiku start/stop command", e); //$NON-NLS-1$
			} catch (InterruptedException e) {
				logger.error("Error while waiting to start", e); //$NON-NLS-1$
				Thread.currentThread().interrupt();
			}
		}
	}

	private void setMacJreHome(ProcessBuilder p) {
		if (SystemUtils.IS_OS_MAC || SystemUtils.IS_OS_MAC_OSX || SystemUtils.IS_OS_LINUX) {

			File javaFolder = new File("./java");

			if (!javaFolder.exists()) {
				String userName = System.getProperty("user.name");
				String testWithPath = "/Users/" + userName + "/OpenForis/CollectEarth/java";
				File testJavaPath = new File(testWithPath);
				if (testJavaPath.exists()) {
					javaFolder = testJavaPath;
				}
			}

			Map<String, String> environment = p.environment();
			environment.put("COLLECT_EARTH_JRE_HOME", javaFolder.getAbsolutePath());

			/*
			 * // In MAC the environment variable COLLECT_EARTH_JRE_HOME is not accesible
			 * from outside the bash, set it again! if( SystemUtils.IS_OS_MAC ||
			 * SystemUtils.IS_OS_MAC_OSX){ try { File javaFolder = new File("./java");
			 *
			 * if( !javaFolder.exists() ){ String userName =
			 * System.getProperty("user.name"); String testWithPath = "/Users/"+userName +
			 * "/OpenForis/CollectEarth/java"; File testJavaPath = new File(testWithPath);
			 * if( testJavaPath.exists()){ javaFolder = testJavaPath; } }
			 *
			 * Process setEnv = runProcessBuilder(new String[] { "/bin/bash", "setenv",
			 * "COLLECT_EARTH_JRE_HOME=\""+ javaFolder.getAbsolutePath() +"\"" });
			 * setEnv.waitFor(); } catch (final IOException e) {
			 * logger.error("Error setting the COLLECT_EARTH_JRE_HOME environment variable",
			 * e); //$NON-NLS-1$ } catch (InterruptedException e) {
			 * logger.error("Error when running COLLECT_EARTH_JRE_HOME environment variable"
			 * , e); //$NON-NLS-1$ } }
			 */
		}
	}

	private Process runProcessBuilder(String[] cmd) throws IOException {
		final ProcessBuilder builder = new ProcessBuilder(cmd);

		// Fixes bug with Mac OS X not using the environemnt variable set for bash
		setMacJreHome(builder);

		builder.directory(new File(localPropertiesService.getSaikuFolder()).getAbsoluteFile());
		builder.redirectErrorStream(true);
		Process p = builder.start();
		(new ProcessLoggerThread(p.getInputStream(), Boolean.FALSE)).start();
		(new ProcessLoggerThread(p.getErrorStream(), Boolean.TRUE)).start();
		return p;
	}

	private String getCommandSuffix() {
		if (SystemUtils.IS_OS_WINDOWS) {
			return COMMAND_SUFFIX_BAT;
		} else {
			return COMMAND_SUFFIX_SH;
		}
	}

	private void startSaiku() throws SaikuExecutionException {
		logger.warn(
				"Starting the Saiku server {}{}{}", localPropertiesService.getSaikuFolder(), File.separator, START_SAIKU); //$NON-NLS-1$

		runSaikuBat(START_SAIKU);

		this.setSaikuStarted(true);

		logger.warn("Finished starting the Saiku server"); //$NON-NLS-1$
	}

	void stopSaiku() throws SaikuExecutionException {
		logger.warn("Stoping the Saiku server {}{}{}", localPropertiesService.getSaikuFolder() , File.separator , STOP_SAIKU); //$NON-NLS-1$
		if (isSaikuStarted()) {
			runSaikuBat(STOP_SAIKU);
			this.setSaikuStarted(true);
		}
		logger.warn("Finished stoping the Saiku server"); //$NON-NLS-1$
	}

	private void stopSaikuOnExit() {
		Runtime.getRuntime().addShutdownHook(new Thread("Shutting down Saiku on exit hook") {
			@Override
			public void run() {
				try {
					if (isSaikuStarted()) {
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
	
	@Override
	public void destroy() throws Exception {
		try {
			stopSaiku();
		} catch (SaikuExecutionException e) {
			logger.error("Error while trying to quite Saiku before destroying the bean", e); //$NON-NLS-1$
		}
	}

	@Override
	public LocalPropertiesService getLocalPropertiesService() {
		return localPropertiesService;
	}

	@Override
	public EarthSurveyService getEarthSurveyService() {
		return earthSurveyService;
	}

	@Override
	public RDBExporter getRdbExporter() {
		return rdbExporter;
	}

}