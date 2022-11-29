package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.IOException;
import java.util.List;

import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.app.service.SchemaService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class IPCCDataExportPerPlotCSV  extends IPCCDataExportCSV  {

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
		
		String selectedYears =  IPCCDataExportTimeSeries.PLOT_ID + 
									", " + IPCCDataExportTimeSeries.CLIMATE_COLUMN_LABEL + 
									", " + IPCCDataExportTimeSeries.SOIL_COLUMN_LABEL + 
									", " + IPCCDataExportTimeSeries.GEZ_COLUMN_LABEL + ", " ;
		
		for( int year = startYear ; year <= endYear; year++ ) {

			selectedYears += IPCCSurveyAdapter.getIpccCategoryAttrName(year) + ", " 
					+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ",";

		}

		String sqlSelect = "select " 
				+ selectedYears
				+ RegionCalculationUtils.EXPANSION_FACTOR  
				+ " from " + schemaName + IPCCDataExportTimeSeries.PLOT_TABLE  + " ," + schemaName + IPCCDataExportTimeSeries.SOIL_TABLE + " ," + schemaName + IPCCDataExportTimeSeries.CLIMATE_TABLE + " ," + schemaName + IPCCDataExportTimeSeries.GEZ_TABLE
				
				+ " where " 
					+ IPCCDataExportTimeSeries.SOIL_COLUMN_IN_PLOT + " = " +  IPCCDataExportTimeSeries.SOIL_COLUMN_ID
					+ " and "
					+ IPCCDataExportTimeSeries.CLIMATE_COLUMN_IN_PLOT + " = " +  IPCCDataExportTimeSeries.CLIMATE_COLUMN_ID
					+ " and "
					+ IPCCDataExportTimeSeries.GEZ_COLUMN_IN_PLOT + " = " +  IPCCDataExportTimeSeries.GEZ_COLUMN_ID
				
				+ " ORDER BY "+ IPCCDataExportTimeSeries.PLOT_ID + " DESC"; // Remove trailing comma from list of years

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
