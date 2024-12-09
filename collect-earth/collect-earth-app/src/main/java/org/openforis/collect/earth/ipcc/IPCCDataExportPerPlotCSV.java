package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.IOException;
import java.util.List;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.app.service.SchemaService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class IPCCDataExportPerPlotCSV  extends AbstractIPCCDataExportCSV  {

	private String schemaName;

	Logger logger = LoggerFactory.getLogger(IPCCDataExportPerPlotCSV.class);

	@Autowired
	private SchemaService schemaService;

	public IPCCDataExportPerPlotCSV() {
		setExportTypeUsed(ExportType.IPCC);
	}

	public File generateTimeseriesData( int startYear, int endYear ) throws IOException {
		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());

		List<String[]> luCombinations = generateLUCombinations(startYear, endYear);

		return createCsv( luCombinations);
	}


	private List<String[]> generateLUCombinations(int startYear, int endYear) {
		
		String selectedYears =  AbstractIPCCDataExportTimeSeries.PLOT_ID + 
									", " + AbstractIPCCDataExportTimeSeries.CLIMATE_COLUMN_LABEL + 
									", " + AbstractIPCCDataExportTimeSeries.SOIL_COLUMN_LABEL + 
									", " + AbstractIPCCDataExportTimeSeries.GEZ_COLUMN_LABEL + ", " ;
		
		for( int year = startYear ; year <= endYear; year++ ) {

			selectedYears += IPCCSurveyAdapter.getIpccCategoryAttrName(year) + ", " 
					+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ",";

		}

		String sqlSelect = "select " 
				+ selectedYears
				+ RegionCalculationUtils.EXPANSION_FACTOR  
				+ " from " + schemaName + AbstractIPCCDataExportTimeSeries.PLOT_TABLE  + " ," + schemaName + AbstractIPCCDataExportTimeSeries.SOIL_TABLE + " ," + schemaName + AbstractIPCCDataExportTimeSeries.CLIMATE_TABLE + " ," + schemaName + AbstractIPCCDataExportTimeSeries.GEZ_TABLE
				
				+ " where " 
					+ AbstractIPCCDataExportTimeSeries.SOIL_COLUMN_IN_PLOT + " = " +  AbstractIPCCDataExportTimeSeries.SOIL_COLUMN_ID
					+ " and "
					+ AbstractIPCCDataExportTimeSeries.CLIMATE_COLUMN_IN_PLOT + " = " +  AbstractIPCCDataExportTimeSeries.CLIMATE_COLUMN_ID
					+ " and "
					+ AbstractIPCCDataExportTimeSeries.GEZ_COLUMN_IN_PLOT + " = " +  AbstractIPCCDataExportTimeSeries.GEZ_COLUMN_ID
					
					+ " and " + EarthConstants.ACTIVELY_SAVED_ATTRIBUTE_NAME + " = " + EarthConstants.ACTIVELY_SAVED_BY_USER_VALUE + " " // Only Actively saved plots so that there are no null Land Uses in the list
					
					+ " and " + EarthConstants.ROUND_ATTRIBUTE_NAME + " =  " + EarthConstants.ROUND_FIRST_ASSESSMENT_VALUE // Use only the data from the first re-assessmnent ( round = 1 ) otherwise we will count the area of the QC plots
				
				+ " ORDER BY "+ AbstractIPCCDataExportTimeSeries.PLOT_ID + " DESC"; // Remove trailing comma from list of years

		List<String[]> luData = getJdbcTemplate().query(
				sqlSelect
				, 
				getRowMapper()
				);

		selectedYears+= "area"; // so the area columns appears too
		luData.add( 0, selectedYears.split(",") );
		return luData;
	}

}
