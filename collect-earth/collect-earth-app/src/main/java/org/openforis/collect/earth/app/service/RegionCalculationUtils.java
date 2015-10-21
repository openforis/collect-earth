package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.sql.SQLException;
import java.util.ArrayList;

import javax.annotation.PostConstruct;

import org.apache.commons.dbcp.BasicDataSource;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.idm.metamodel.Schema;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import au.com.bytecode.opencsv.CSVReader;


@Component
public class RegionCalculationUtils {

	private static final String SHRUB_COUNT = "shrub_count";
	private static final String TREE_COUNT = "tree_count";
	private static final String REGION_AREAS_CSV = "region_areas.csv"; //$NON-NLS-1$
	private static final String ATTRIBUTE_AREAS_CSV = "areas_per_attribute.csv"; //$NON-NLS-1$
	private static final String PLOT_WEIGHT = "plot_weight"; //$NON-NLS-1$
	private static final String EXPANSION_FACTOR = "expansion_factor"; //$NON-NLS-1$
	private static final String TREES_PER_EXP_FACTOR = "trees_per_expansion_factor"; //$NON-NLS-1$
	private static final String SHRUBS_PER_EXP_FACTOR = "shrubs_per_expansion_factor"; //$NON-NLS-1$
	private final Logger logger = LoggerFactory.getLogger(RegionCalculationUtils.class);

	private static final String NO_DATA_LAND_USE = "noData"; //$NON-NLS-1$
	
	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	LocalPropertiesService localPropertiesService;

	@Autowired
	private BasicDataSource rdbDataSource;
	
	@Autowired
	private SchemaService schemaService;

	private JdbcTemplate jdbcTemplate;
	
	
	@PostConstruct
	public void initialize() {
		jdbcTemplate = new JdbcTemplate(rdbDataSource);
	}
	
	public void handleRegionCalculation(){
		try {
			createWeightFactors();
			// If the region_areas.csv is not present then try to add the areas "per attribute" using the file areas_per_attribute.csv
			if(!addAreasPerRegion()){
				addAreasPerAttribute();
			}
		} catch (Exception e) {
			logger.error( "Error when calculating hte expansion factors for the plots ", e);
		}
	}
	
	private void createWeightFactors(){
		final String schemaName = schemaService.getSchemaPrefix();
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD " + EXPANSION_FACTOR + " FLOAT"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD " + PLOT_WEIGHT + " FLOAT"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
	}
	
	/**
	 * This is the "old way"of assigning an expansion factor (the area in hecaters that a plot represents) to a plot based on the information form the "region_areas.csv" file.
	 * @return True if there was a region_areas.csv file, false if not present so that areas were not assigned.
	 * @throws SQLException
	 */
	private boolean addAreasPerRegion() throws SQLException {

		final File regionAreas = new File( localPropertiesService.getProjectFolder() + File.separatorChar + REGION_AREAS_CSV);
		String schemaName = schemaService.getSchemaPrefix();
		
		if (regionAreas.exists()) {

			try {
				CSVReader csvReader = CsvReaderUtils.getCsvReader(regionAreas.getAbsolutePath());
				String[] csvLine = null;

				while( ( csvLine = csvReader.readNext() ) != null ){
					try {
						String region = csvLine[0];
						String plot_file = csvLine[1];
						int area_hectars =  Integer.parseInt( csvLine[2] );
						final Float plot_weight =  Float.parseFloat( csvLine[3] );

						Object[] parameters = new String[]{region,plot_file};

						Integer plots_per_region = jdbcTemplate.queryForObject( 
								"SELECT count("+EarthConstants.PLOT_ID+") FROM " + schemaName  + "plot  WHERE ( region=? OR plot_file=? ) AND land_use_category != '"+NO_DATA_LAND_USE+"' ", parameters,Integer.class); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$

						Float expansion_factor_hectars_calc = 0f;
						if( plots_per_region.intValue() != 0 ){
							expansion_factor_hectars_calc = (float)area_hectars / (float) plots_per_region.intValue();
						}
					
						final Object[] updateValues = new Object[4];
						updateValues[0] = expansion_factor_hectars_calc;
						updateValues[1] = plot_weight;
						updateValues[2] = region;
						updateValues[3] = plot_file;
						jdbcTemplate.update("UPDATE " + schemaName + "plot SET "+EXPANSION_FACTOR+"=?, "+PLOT_WEIGHT+"=? WHERE region=? OR plot_file=?", updateValues); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
						
					} catch (NumberFormatException e) {
						logger.error("Possibly the header", e); //$NON-NLS-1$
					} 

				}
				
				// FINALLY ASSIGN A WEIGHT OF CERO AND AN EXPANSION FACTOR OF 0 FOR THE PLOTS WITH NO_DATA
				
				final Object[] updateNoDataValues = new Object[3];
				updateNoDataValues[0] = 0;
				updateNoDataValues[1] = 0;
				updateNoDataValues[2] = NO_DATA_LAND_USE;
				
				jdbcTemplate.update("UPDATE " + schemaName + "plot SET "+EXPANSION_FACTOR+"=?, "+PLOT_WEIGHT+"=? WHERE land_use_category=?", updateNoDataValues); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
				
				handleNumberOfTrees( schemaName );
				handleNumberOfShrubs( schemaName );
				
			} catch (FileNotFoundException e) {
				logger.error("File not found?", e); //$NON-NLS-1$
			} catch (IOException e) {
				logger.error("Error reading the CSV file", e); //$NON-NLS-1$
			}

			return true;
		}else{
			logger.warn("No CSV region_areas.csv present, calculating areas will not be possible"); //$NON-NLS-1$
			return false;
		}

	}
	
	
	private void handleNumberOfShrubs(String schemaName) {
		// This is specific to the Global Forest Survey - Drylands monitoring assessment
		if( AnalysisSaikuService.surveyContains(SHRUB_COUNT, earthSurveyService.getCollectSurvey() ) ){
			// First set the number of shrubs to 30 if the user assessed that there were more than 30 shrubs on the plot
			// This way we get a conservative estimation
			jdbcTemplate.update("UPDATE " + schemaName + "plot SET "+SHRUB_COUNT+"=30 WHERE many_shrubs=1"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
			jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD " + SHRUBS_PER_EXP_FACTOR + " FLOAT"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			jdbcTemplate.update("UPDATE " + schemaName + "plot SET "+SHRUBS_PER_EXP_FACTOR+"="+EXPANSION_FACTOR+"*2*"  + SHRUB_COUNT); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		}
	}

	private void handleNumberOfTrees(String schemaName) {
		// This is specific to the Global Forest Survey - Drylands monitoring assessment
		if( AnalysisSaikuService.surveyContains(TREE_COUNT, earthSurveyService.getCollectSurvey() ) ){
			// First set the number of shrubs to 30 if the user assessed that there were more than 30 shrubs on the plot
			// This way we get a conservative estimation
			jdbcTemplate.update("UPDATE " + schemaName + "plot SET "+TREE_COUNT+"=30 WHERE many_trees=1"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
			jdbcTemplate.execute("ALTER TABLE " + schemaName + "plot ADD " + TREES_PER_EXP_FACTOR + " FLOAT"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			jdbcTemplate.update("UPDATE " + schemaName + "plot SET "+TREES_PER_EXP_FACTOR+"="+EXPANSION_FACTOR+"*2*"  + TREE_COUNT); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		}
	}

	private boolean addAreasPerAttribute() throws SQLException {

		final File areasPerAttribute = new File( localPropertiesService.getProjectFolder() + File.separatorChar + ATTRIBUTE_AREAS_CSV);
		String schemaName = schemaService.getSchemaPrefix();
		
		if (areasPerAttribute.exists()) {

			try {
				CSVReader csvReader = CsvReaderUtils.getCsvReader(areasPerAttribute.getAbsolutePath());
				String[] csvLine = null;
				
				// The header (first line) should contain the names of the three columns : attribute_name,area,weight
				
				String[] columnNames = csvReader.readNext();
				
				ArrayList<String> attributeNames = new ArrayList<String>();
				
				if(columnNames.length < 3 ){
					throw new RuntimeException("The " + areasPerAttribute.getAbsolutePath() + " file needs have this format : attribute_name1,attribute_name2,...attribute_nameN,area,weight./nAt least one attribute is necessary. This wuuld be the attribute or attributes (their name in the survey definition) that would realte the plot with its expancion factor");
				}
				
				for( int colPosition = 0; colPosition<columnNames.length -2; colPosition++){
					String attributeName = columnNames[colPosition];
									
					// Validate attribute name
					if( !isAttributeInPlotEntity( attributeName ) ){
						throw new RuntimeException("The expected format of the CSV file at " + areasPerAttribute.getAbsolutePath() + " should be attribute_name,area,weight. The name of the attribute in hte first column of your CSV '" + attributeName + "'is not a attribute under the plot entity.");
					}
					
					attributeNames.add(attributeName);
				}
				
				//Validate area and weight headers.
				if( !columnNames[ columnNames.length -2 ].equalsIgnoreCase("area") || !columnNames[columnNames.length -1].equalsIgnoreCase("weight")){
					throw new RuntimeException("The expected format of the CSV file at " + areasPerAttribute.getAbsolutePath() + " should be attribute_name,area,weight");
				}
				
				while( ( csvLine = csvReader.readNext() ) != null ){
					
					int area_hectars = Integer.parseInt( csvLine[columnNames.length -2] );
					final Float plot_weight =  Float.parseFloat( csvLine[columnNames.length -1] );
					
						int numberOfAttributes = attributeNames.size();
					
						ArrayList<Object> attributeValues = new ArrayList<Object>(); 
						for(int attributeValueCol = 0; attributeValueCol<numberOfAttributes;attributeValueCol++){
							attributeValues.add(csvLine[attributeValueCol]);
						}						

						
						StringBuffer selectQuery = new StringBuffer();
						selectQuery.append("SELECT count(").append(EarthConstants.PLOT_ID).append(") FROM ").append(schemaName).append("plot  WHERE ");
						for (int attr =0; attr<attributeNames.size() ; attr++) {
							String attributeName = attributeNames.get(attr);
							selectQuery.append(attributeName);
							if( attr == numberOfAttributes-1 ){
								selectQuery.append("=? ");
							}else{
								selectQuery.append("=? AND ");
							}
							
						}

						Integer plots_per_region = jdbcTemplate.queryForObject(selectQuery.toString(), attributeValues.toArray(), Integer.class); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
					
						// Calculate the expansion factor. Simply the deivision of the area for the selected attributes by the amount of plots that match the attribute values
						Float expansion_factor_hectars_calc = 0f;
						if( plots_per_region.intValue() != 0 ){
							expansion_factor_hectars_calc = (float)area_hectars / (float) plots_per_region.intValue();
						}

						
						// Build the update query
						StringBuffer updateQuery = new StringBuffer();
						updateQuery.append("UPDATE ").append(schemaName).append("plot SET ").append(EXPANSION_FACTOR).append("=?, ").append(PLOT_WEIGHT).append("=? WHERE ");
						for (int attr =0; attr<attributeNames.size() ; attr++) {
							String attributeName = attributeNames.get(attr);
							updateQuery.append(attributeName);
							if( attr == numberOfAttributes-1 ){
								updateQuery.append("=? ");
							}else{
								updateQuery.append("=? AND ");
							}
							
						}
						
						// Add the expansion factor and plot_weight to the values that will be sent with the update
						attributeValues.add(0, expansion_factor_hectars_calc);
						attributeValues.add(1, plot_weight);
						
						jdbcTemplate.update(updateQuery.toString(), attributeValues.toArray()); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
				}
				
				handleNumberOfTrees( schemaName );
				handleNumberOfShrubs( schemaName );
								
			} catch (FileNotFoundException e) {
				logger.error("File not found?", e); //$NON-NLS-1$
			} catch (IOException e) {
				logger.error("Error reading the CSV file", e); //$NON-NLS-1$
			}

			return true;
		}else{
			logger.warn("No CSV region_areas.csv present, calculating areas will not be possible"); //$NON-NLS-1$
			return false;
		}

	}

	private boolean isAttributeInPlotEntity(String attributeName) {
		Schema schema = earthSurveyService.getCollectSurvey().getSchema();
		boolean attributeExists = true;
		try {
			schema.getRootEntityDefinition(EarthConstants.ROOT_ENTITY_NAME ).getChildDefinition(attributeName);
		} catch (Exception e) {
			// The attribute does not exist under the plot entity
			attributeExists = false;
		}
		return attributeExists;
	}


}
