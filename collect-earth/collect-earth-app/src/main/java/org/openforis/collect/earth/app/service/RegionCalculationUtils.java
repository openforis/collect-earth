package org.openforis.collect.earth.app.service;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

import org.apache.commons.dbcp.BasicDataSource;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.RDBExporter.ExportType;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.idm.metamodel.BooleanAttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.opencsv.CSVReader;

@Component
public class RegionCalculationUtils implements InitializingBean{

	private static final String AREA_CSV_COLUMN = "area";
	private static final String WEIGHT_CSV_COLUMN = "weight";
	private static final String PLOT_SET = "plot SET ";
	private static final String UPDATE = "UPDATE ";
	private static final String PLOT_ADD = "plot ADD ";
	private static final String FLOAT = " FLOAT";
	private static final String ALTER_TABLE = "ALTER TABLE ";
	private static final String ALTER_TABLE2 = ALTER_TABLE;
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
	private static final String MANY_TREES = "many_trees";
	private static final String MANY_SHRUBS = "many_shrubs";

	@Autowired
	EarthSurveyService earthSurveyService;

	@Autowired
	LocalPropertiesService localPropertiesService;

	@Autowired
	private BasicDataSource rdbDataSource;

	@Autowired
	private SchemaService schemaService;

	private JdbcTemplate jdbcTemplate;

	private ExportType exportType;
	
	@Override
	public void afterPropertiesSet() throws Exception {
		jdbcTemplate = new JdbcTemplate(rdbDataSource);
	}

	public void handleRegionCalculation(ExportType exportType){
		try {
			setExportType(exportType);
			createWeightFactors();

			// If the region_areas.csv is not present then try to add the areas "per attribute" using the file areas_per_attribute.csv
			boolean areasAdded = false;
			if(!addAreasPerRegion()){
				if( addAreasPerAttribute() ){
					areasAdded = true;
				}
			}else{
				areasAdded = true;
			}

			if( areasAdded ){
				handleNumberOfTrees();
				handleNumberOfShrubs();
				recalculatePlotWeights();
			}

		} catch (Exception e) {
			logger.error( "Error when calculating the expansion factors for the plots ", e);
		}
	}

	private void recalculatePlotWeights() {
		String schemaName = getSchemaPrefix();
		String selectMinExpansionFactorSql = String.format("SELECT MIN(%s) FROM %splot", EXPANSION_FACTOR, schemaName); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		Double minExpansionFactor = jdbcTemplate.queryForObject(selectMinExpansionFactorSql, Double.class);
		//set plot_weight = expansion_factor / minExpansionFactor
		String updatePlotWeightSql = String.format(Locale.US, "UPDATE %splot SET %s=%s/%.5f", schemaName, PLOT_WEIGHT, EXPANSION_FACTOR, minExpansionFactor); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		jdbcTemplate.update(updatePlotWeightSql);
	}

	private String getSchemaPrefix() {
		return schemaService.getSchemaPrefix( getExportType() );
	}

	private void createWeightFactors(){
		final String schemaName = getSchemaPrefix();
		jdbcTemplate.execute(ALTER_TABLE2 + schemaName + PLOT_ADD + EXPANSION_FACTOR + FLOAT); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
		jdbcTemplate.execute(ALTER_TABLE2 + schemaName + PLOT_ADD + PLOT_WEIGHT + FLOAT); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
	}

	/**
	 * This is the "old way"of assigning an expansion factor (the area in hectares that a plot represents) to a plot based on the information form the "region_areas.csv" file.
	 * @return True if there was a region_areas.csv file, false if not present so that areas were not assigned.
	 */
	private boolean addAreasPerRegion() {

		final File regionAreas = new File( localPropertiesService.getProjectFolder() + File.separatorChar + REGION_AREAS_CSV);
		String schemaName = getSchemaPrefix();

		if (regionAreas.exists()) {

			try( CSVReader csvReader = CsvReaderUtils.getCsvReader(regionAreas.getAbsolutePath()) ) {

				String[] csvLine = null;

				while( ( csvLine = csvReader.readNext() ) != null ){
					try {
						String region = csvLine[0];
						String plotFile = csvLine[1];
						int areaHectares =  Integer.parseInt( csvLine[2] );
						final Float plotWeight =  1f; // The plot weight will always be calculated in a later step

						Object[] parameters = new String[]{region,plotFile};

						Integer plotsInRegion = jdbcTemplate.queryForObject(
								"SELECT count( DISTINCT "+EarthConstants.PLOT_ID+") FROM " + schemaName  + "plot  WHERE ( region=? OR plot_file=? ) AND land_use_category != '"+NO_DATA_LAND_USE+"' ",
								Integer.class,
								parameters); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$

						Float expansionFactorHectaresCalc = 0f;
						if( plotsInRegion.intValue() != 0 ){
							expansionFactorHectaresCalc = (float)areaHectares / (float) plotsInRegion.intValue();
						}

						final Object[] updateValues = new Object[4];
						updateValues[0] = expansionFactorHectaresCalc;
						updateValues[1] = plotWeight;
						updateValues[2] = region;
						updateValues[3] = plotFile;
						jdbcTemplate.update(UPDATE + schemaName + PLOT_SET+EXPANSION_FACTOR+"=?, "+PLOT_WEIGHT+"=? WHERE region=? OR plot_file=?", updateValues); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$

					} catch (NumberFormatException e) {
						logger.error("Possibly the header", e); //$NON-NLS-1$
					}

				}

				// FINALLY ASSIGN A WEIGHT OF CERO AND AN EXPANSION FACTOR OF 0 FOR THE PLOTS WITH NO_DATA

				final Object[] updateNoDataValues = new Object[3];
				updateNoDataValues[0] = 0;
				updateNoDataValues[1] = 0;
				updateNoDataValues[2] = NO_DATA_LAND_USE;

				jdbcTemplate.update(UPDATE + schemaName + PLOT_SET+EXPANSION_FACTOR+"=?, "+PLOT_WEIGHT+"=? WHERE land_use_category=?", updateNoDataValues); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$


			} catch (FileNotFoundException e) {
				logger.error("File not found?", e); //$NON-NLS-1$
			} catch (Exception e) {
				logger.error("Error reading the CSV file", e); //$NON-NLS-1$
			}

			return true;
		}else{
			logger.warn("No CSV region_areas.csv present, calculating areas will not be possible"); //$NON-NLS-1$
			return false;
		}

	}


	private void handleNumberOfShrubs() {
		String schemaName = getSchemaPrefix();
		// This is specific to the Global Forest Survey - Drylands monitoring assessment
		if(
			AnalysisSaikuService.surveyContains(SHRUB_COUNT, earthSurveyService.getCollectSurvey() )
				&&
			AnalysisSaikuService.surveyContains(MANY_SHRUBS, earthSurveyService.getCollectSurvey() )
		){
			// First set the number of shrubs to 30 if the user assessed that there were more than 30 shrubs on the plot
			// This way we get a conservative estimation
			jdbcTemplate.update(UPDATE + schemaName + PLOT_SET+SHRUB_COUNT+"=30 WHERE  " + MANY_SHRUBS + "='1'"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
			jdbcTemplate.execute(ALTER_TABLE2 + schemaName + PLOT_ADD + SHRUBS_PER_EXP_FACTOR + FLOAT); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			jdbcTemplate.update(UPDATE + schemaName + PLOT_SET+SHRUBS_PER_EXP_FACTOR+"="+EXPANSION_FACTOR+"*2*"  + SHRUB_COUNT); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		}
	}

	private void handleNumberOfTrees() {
		String schemaName = getSchemaPrefix();
		// This is specific to the Global Forest Survey - Drylands monitoring assessment
		if(
			AnalysisSaikuService.surveyContains(TREE_COUNT, earthSurveyService.getCollectSurvey() )
				&&
			AnalysisSaikuService.surveyContains(MANY_TREES, earthSurveyService.getCollectSurvey() )
		){
			// First set the number of shrubs to 30 if the user assessed that there were more than 30 shrubs on the plot
			// This way we get a conservative estimation
			jdbcTemplate.update(UPDATE + schemaName + PLOT_SET+TREE_COUNT+"=30 WHERE " + MANY_TREES + "='1'"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
			jdbcTemplate.execute(ALTER_TABLE2 + schemaName + PLOT_ADD + TREES_PER_EXP_FACTOR + FLOAT); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
			jdbcTemplate.update(UPDATE + schemaName + PLOT_SET+TREES_PER_EXP_FACTOR+"="+EXPANSION_FACTOR+"*2*"  + TREE_COUNT); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
		}
	}

	private boolean addAreasPerAttribute() {

		final File areasPerAttribute = new File( localPropertiesService.getProjectFolder() + File.separatorChar + ATTRIBUTE_AREAS_CSV);
		String schemaName = getSchemaPrefix();

		if (areasPerAttribute.exists()) {

			try ( CSVReader csvReader = CsvReaderUtils.getCsvReader(areasPerAttribute.getAbsolutePath(), false) ){
				// The header (first line) should contain the names of the three columns : attribute_name,area

				String[] columnNames = csvReader.readNext();
				

				ArrayList<String> attributeNames = new ArrayList<String>();

				if(columnNames.length < 2 ){
					throw new RuntimeException("The " + areasPerAttribute.getAbsolutePath() + " file needs have this format : attribute_name1,attribute_name2,...attribute_nameN,"+AREA_CSV_COLUMN+"./nAt least one attribute is necessary. This would be the attribute or attributes (their name in the survey definition) that would relate the plot with its expansion factor");
				}

				// The weight column has been removed in the latest versions of the areas per attribute csv
				// Lets add it again for backward compatibility
				if( !columnNames[columnNames.length -1].equalsIgnoreCase(WEIGHT_CSV_COLUMN) ) {
					// We need to create anew array with an extra item
					String[] longer = new String[columnNames.length + 1];
					for (int i = 0; i < columnNames.length; i++)
						longer[i] = columnNames[i];
					longer[columnNames.length] = WEIGHT_CSV_COLUMN; // add the 
					columnNames = longer;
				}

				for( int colPosition = 0; colPosition<columnNames.length -2; colPosition++){
					String attributeName = columnNames[colPosition];

					// Validate attribute name
					if( !isAttributeInPlotEntity( attributeName ) ){
						throw new RuntimeException("The expected format of the CSV file at " + areasPerAttribute.getAbsolutePath() + " should be attribute_name,"+AREA_CSV_COLUMN
								+ "The name of the attribute in the first column of your CSV '" + attributeName + "'is not an attribute under the plot entity.");
					}

					attributeNames.add(attributeName);
				}

				//Validate area and weight headers.
				if( !columnNames[ columnNames.length -2 ].equalsIgnoreCase(AREA_CSV_COLUMN) || !columnNames[columnNames.length -1].equalsIgnoreCase(WEIGHT_CSV_COLUMN)){
					throw new RuntimeException("The expected format of the CSV file at " + areasPerAttribute.getAbsolutePath() + " should be attribute_name,"+AREA_CSV_COLUMN);
				}

				int numberOfAttributes = attributeNames.size();
				StringBuilder attributeWhereConditionsSB = new StringBuilder();
				for (int attrIdx=0; attrIdx < numberOfAttributes ; attrIdx++) {
					String attributeName = attributeNames.get(attrIdx);
					attributeWhereConditionsSB.append(attributeName);
					if( attrIdx == numberOfAttributes-1 ){
						attributeWhereConditionsSB.append("=? ");
					} else{
						attributeWhereConditionsSB.append("=? AND ");
					}
				}
				String attributeWhereConditions = attributeWhereConditionsSB.toString();

				StringBuilder selectQuerySB = new StringBuilder();
				selectQuerySB.append("SELECT count(  DISTINCT ").append(EarthConstants.PLOT_ID).append(") FROM ").append(schemaName).append("plot  WHERE ").append(attributeWhereConditions);
				String plotCountSelectQuery = selectQuerySB.toString();

				// Build the update query
				StringBuilder updateQuerySB = new StringBuilder();
				updateQuerySB.append(UPDATE).append(schemaName).append(PLOT_SET).append(EXPANSION_FACTOR).append("=?, ").append(PLOT_WEIGHT).append("=? WHERE ").append(attributeWhereConditions);

				String updatePlotQuery = updateQuerySB.toString();

				List<Object[]> batchArgs = new ArrayList<>();
				int line = 1;
				String[] csvLine = null;
				while( ( csvLine = csvReader.readNext() ) != null ){
					try{
						float areaHectares = Float.parseFloat( csvLine[columnNames.length -2] );
						final Float plotWeight =  Float.parseFloat( csvLine[columnNames.length -1] );

						List<Object> attributeValues = extractAttributeValues(csvLine, attributeNames);

						Integer plotCountPerAttributes = jdbcTemplate.queryForObject(plotCountSelectQuery,  Integer.class, attributeValues.toArray()); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$

						// Calculate the expansion factor: simply the division of the area for the selected attributes by the amount of plots that match the attribute values
						Float expansionFactorHectaresCalc = 0f;
						if( plotCountPerAttributes.intValue() != 0 ){
							expansionFactorHectaresCalc = areaHectares / (float) plotCountPerAttributes.intValue();
						}

						// Add the expansion factor and plot_weight to the values that will be sent with the update
						attributeValues.add(0, expansionFactorHectaresCalc);
						attributeValues.add(1, plotWeight);

						batchArgs.add(attributeValues.toArray());
					}catch( Exception e5){
						logger.error("Problem in line number " + line + " with values "  + Arrays.toString( csvLine ), e5 );
					}finally{
						line++;
					}
				}
				jdbcTemplate.batchUpdate(updatePlotQuery, batchArgs);
			} catch (FileNotFoundException e) {
				logger.error("File not found?", e); //$NON-NLS-1$
			} catch (Exception e) {
				logger.error("Error reading the CSV file", e); //$NON-NLS-1$
			}

			return true;
		}else{
			logger.warn("No CSV region_areas.csv present, calculating areas will not be possible"); //$NON-NLS-1$
			return false;
		}

	}

	private List<Object> extractAttributeValues(String[] csvLine, List<String> attributeNames) {
		List<Object> values = new ArrayList<>(attributeNames.size());
		for(int colIndex = 0; colIndex < attributeNames.size(); colIndex++) {
			String stringValue = csvLine[colIndex];
			String attributeName = attributeNames.get(colIndex);
			Object value = getTypedValue(attributeName, stringValue);
			values.add(value);
		}
		return values;
	}

	private Object getTypedValue(String attributeName, String stringValue) {
		EntityDefinition rootEntityDef = earthSurveyService.getRootEntityDefinition();
		NodeDefinition attributeDef = rootEntityDef.getChildDefinition(attributeName);
		if (attributeDef instanceof BooleanAttributeDefinition) {
			return Boolean.TRUE.toString().equalsIgnoreCase(stringValue) || "1".equals(stringValue);
		} else {
			return stringValue;
		}
	}

	private boolean isAttributeInPlotEntity(String attributeName) {
		EntityDefinition rootEntityDefinition = earthSurveyService.getRootEntityDefinition();
		try {
			rootEntityDefinition.getChildDefinition(attributeName);
		} catch (Exception e) {
			// The attribute does not exist under the plot entity
			return false;
		}
		return true;
	}

	public ExportType getExportType() {
		return exportType;
	}

	public void setExportType(ExportType exportType) {
		this.exportType = exportType;
	}


}
