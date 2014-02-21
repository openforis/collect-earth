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
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.sampler.model.AspectCode;
import org.openforis.collect.earth.sampler.model.SlopeCode;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.manager.SurveyManager;
import org.openforis.collect.model.CollectRecord.Step;
import org.openforis.collect.relational.CollectRDBPublisher;
import org.openforis.collect.relational.CollectRdbException;
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

	private static final String COLLECT_EARTH_DATABASE_RDB_DB = "collectEarthDatabaseRDB.db";

	@Autowired
	CollectRDBPublisher collectRDBPublisher;

	@Autowired
	SurveyManager surveyManager;

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
	
	@PostConstruct
	public void initialize() {
		jdbcTemplate = new JdbcTemplate(rdbDataSource);
	}
	
	
	private static final String FREEMARKER_HTML_TEMPLATE = "resources/collectEarthDS.fmt";
	private static final String MDX_XML = "collectEarthCubes.xml";

	private void refreshDataSourceForSaiku() throws IOException {

		HashMap<String, String> data = new HashMap<String, String>();
		
		File rdbDb =  new File(COLLECT_EARTH_DATABASE_RDB_DB) ;
		File cubeDefinition =  new File( getIdmFolder() + File.separatorChar + MDX_XML) ;
		File dataSourceTemplate = new File(KmlGenerator.convertToOSPath(FREEMARKER_HTML_TEMPLATE ) );
		
		
		if( !rdbDb.exists()) {
			throw new IOException("The file contianing the Relational SQLite Database does not exist in expected location " + rdbDb.getAbsolutePath());
		}
		
		if( !cubeDefinition.exists()) {
			throw new IOException("The file contianing the MDX Cube definition does not exist in expected location " + cubeDefinition.getAbsolutePath() );
		}
		
		if( !dataSourceTemplate.exists()) {
			throw new IOException("The file contianing the Saiku Data Source template does not exist in expected location " + dataSourceTemplate.getAbsolutePath() );
		}
		
		data.put( "rdbFilePath", rdbDb.getAbsolutePath().replace('\\', '/') );
		data.put( "cubeFilePath", cubeDefinition.getAbsolutePath().replace('\\', '/')  );
		
		// Process the template file using the data in the "data" Map
		final Configuration cfg = new Configuration();
		
		cfg.setDirectoryForTemplateLoading(dataSourceTemplate.getParentFile());

		// Load template from source folder
		final Template template = cfg.getTemplate(dataSourceTemplate.getName());

		final File saikuConfigFile = new File( getSaikuConfigurationFilePath() );
		
		// Console output
		BufferedWriter fw = null;
		try {
			fw = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(saikuConfigFile), Charset.forName("UTF-8")));
			template.process(data, fw);
		} catch (TemplateException e) {
			logger.error( "Problemsa when processing the template for the Saiku data source", e);
		} finally {
			if (fw != null) {
				fw.close();
			}
		}

	}
	
	private String getIdmFolder() {
		File metadataFile = new File( localPropertiesService.getValue( EarthProperty.METADATA_FILE ) );
		return metadataFile.getParent();
	}

	private String getSaikuConfigurationFilePath(){
		String saikuFolder = localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER);
		String configFile = saikuFolder + "/" + "tomcat/webapps/saiku/WEB-INF/classes/saiku-datasources/collectEarthDS"; 
		configFile = configFile.replace( '/', File.separatorChar );
		return configFile;
	}

	private void assignDimensionValues() {

		// Objet[] --> aspect_id, sloped_id, elevation_bucket_id, _plot_id
		final List<Object[]> sqlUpdateValues = jdbcTemplate.query("SELECT _plot_id, elevation, slope, aspect FROM plot", new RowMapper<Object[]>() {
			@Override
			public Object[] mapRow(ResultSet rs, int rowNum) throws SQLException {

				final Object[] updateValues = new Object[4];

				Integer aspect = AspectCode.NA.getId();
				if( AspectCode.getAspectCode(rs.getDouble("aspect")) != null  ){
					aspect = AspectCode.getAspectCode(rs.getDouble("aspect")).getId();
				}
				
				Integer slope = SlopeCode.NA.getId();
				
				if( SlopeCode.getSlopeCode( (int) rs.getFloat("slope")) != null ){
					slope = SlopeCode.getSlopeCode( (int)rs.getFloat("slope") ).getId();
				}
				
				Integer elevationBucket = 0;
				updateValues[0] = aspect;
				updateValues[1] = slope;
				updateValues[2] = Math.floor(  (int)rs.getFloat("elevation") / ELEVATION_RANGE ) + 1; // 0meters is bucket 1 ( id);
				updateValues[3] = rs.getInt("_plot_id");
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
		int slots = (int) Math.ceil( 9000 / ELEVATION_RANGE  ); // Highest mountain in the world, mount everest is 8820m high
		for( int i=1; i<=slots; i++ ){
			jdbcTemplate.execute("INSERT INTO elevation_category values (" + i + ", '" + ( (i-1)*ELEVATION_RANGE) + "-" + i*ELEVATION_RANGE+ "')");
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

	private String getSaikuFolder() {
		File saikuFolder  = new File( localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER) ); 
		return saikuFolder.getAbsolutePath();
	}

	private void openSaiku() throws IOException {
		
		saikuWebDriver = browserService.navigateTo("http://localhost:8181", saikuWebDriver);
		browserService.waitFor("username", saikuWebDriver);
		saikuWebDriver.findElementByName("username").sendKeys("admin");
		saikuWebDriver.findElementByName("password").sendKeys("admin");
		saikuWebDriver.findElementByClassName("form_button").click();
		
	}

	public void prepareAnalysis() {

		try {
			stopSaiku();
				
			removeOldRdb();
			
			collectRDBPublisher.export(EarthConstants.EARTH_SURVEY_NAME, EarthConstants.ROOT_ENTITY_NAME, Step.ENTRY, null);

			try {
				refreshDataSourceForSaiku();
				
				processQuantityData();
				startSaiku();
				new Thread(){
					public void run() {
						try {
							AnalysisSaikuService.this.openSaiku();
						} catch (IOException e) {
							logger.error("Error opening the Saiku interface", e);
						}
					};
				}.start();
				
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
		
		createAspectAuxTable();
		createSlopeAuxTable();
		createElevationtAuxTable();
		createPlotForeignKeys();
		assignDimensionValues();
	}
	
	private void removeOldRdb() {
			
		
		List<String> tables = new ArrayList<String>();
		List<Map<String, Object>> listOfTables = jdbcTemplate.queryForList("SELECT name FROM sqlite_master WHERE type='table';");
		for (Map<String, Object> entry : listOfTables) {
			String tableName = (String) entry.get("name");
		    if ( !tableName.equals("sqlite_sequence"))
		        tables.add(tableName);
		  
		}
	
		for(String tableName:tables) {
			jdbcTemplate.execute("DROP TABLE IF EXISTS " + tableName);
		}
		
		final File oldRdbFile = new File(COLLECT_EARTH_DATABASE_RDB_DB);
		oldRdbFile.delete();
		
		final File oldRdbFileSaiku =new File(getSaikuFolder() + File.separatorChar + COLLECT_EARTH_DATABASE_RDB_DB);
		oldRdbFileSaiku.delete();

		
	}

	private void startSaiku() {
		logger.warn("Starting the Saiku server"+ getSaikuFolder() + File.separator + "start-saiku.bat" );
		
		runSaikuBat("start-saiku.bat");	
	    
		logger.warn("Finished starting the Saiku server");
	}

	public void stopSaiku() {
		logger.warn("Stoping the Saiku server"+ getSaikuFolder() + File.separator + "start-saiku.bat" );
		
		runSaikuBat("stop-saiku.bat");	
	    
		logger.warn("Finished stoping the Saiku server");
	}
	
	private void runSaikuBat( String batName ){
		String saikuCmd = "\"" + getSaikuFolder() +  File.separator + batName + "\"";
		try {
			ProcessBuilder builder = new ProcessBuilder( new String[]{ saikuCmd });
			builder.directory(new File( getSaikuFolder() ));
			builder.redirectErrorStream(true);
			builder.start();
		} catch (IOException e) {
			logger.error("Error when running Saiku start/stop command", saikuCmd);
		}
	}
	
	
	private void stopSaikuOnExit() {
		Runtime.getRuntime().addShutdownHook(new Thread() {
			@Override
			public void run() {
				stopSaiku();
			}

		});
	}

}
