package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class IPCCDataExportLandUnitsCSV extends AbstractIPCCDataExportCSV {

	private String schemaName;

	Logger logger = LoggerFactory.getLogger(IPCCDataExportLandUnitsCSV.class);
	
	private final static String LAND_UNIT_ID = "land_unit_id";

	public IPCCDataExportLandUnitsCSV() {
		super();
		setExportTypeUsed(ExportType.IPCC);
	}

	public File generateTimeseriesData( int startYear, int endYear ) throws IOException {
		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());
		List<String[]> luCombinations = generateLUCombinations(startYear, endYear);
		return createCsv( luCombinations);
	}

	private String getSqlSelectForStrata(String selectedYears) {
		String sqlSelect = "select " 
				+ selectedYears
				+ " sum( " + RegionCalculationUtils.EXPANSION_FACTOR + ")" 
				+ " from " + schemaName + AbstractIPCCDataExportTimeSeries.PLOT_TABLE  + " ," + schemaName + AbstractIPCCDataExportTimeSeries.SOIL_TABLE + " ," + schemaName + AbstractIPCCDataExportTimeSeries.CLIMATE_TABLE + " ," + schemaName + AbstractIPCCDataExportTimeSeries.GEZ_TABLE
				
				+ " where " 
					+ AbstractIPCCDataExportTimeSeries.SOIL_COLUMN_IN_PLOT + " = " +  AbstractIPCCDataExportTimeSeries.SOIL_COLUMN_ID
					+ " and "
					+ AbstractIPCCDataExportTimeSeries.CLIMATE_COLUMN_IN_PLOT + " = " +  AbstractIPCCDataExportTimeSeries.CLIMATE_COLUMN_ID
					+ " and "
					+ AbstractIPCCDataExportTimeSeries.GEZ_COLUMN_IN_PLOT + " = " +  AbstractIPCCDataExportTimeSeries.GEZ_COLUMN_ID
				
				+ " GROUP BY "
				+ selectedYears.substring(0, selectedYears.length()-1)
				+ " ORDER BY sum( "+ RegionCalculationUtils.EXPANSION_FACTOR + " ) DESC"; // Remove trailing comma from list of years
		return sqlSelect;
	}

	private static String getGroupingOfStrata(int startYear, int endYear) {
		String selectedYears = AbstractIPCCDataExportTimeSeries.CLIMATE_COLUMN_LABEL + 
								", " + AbstractIPCCDataExportTimeSeries.SOIL_COLUMN_LABEL + 
								", " + AbstractIPCCDataExportTimeSeries.GEZ_COLUMN_LABEL + ", " ;
		for( int year = startYear ; year <= endYear; year++ ) {
			selectedYears += IPCCSurveyAdapter.getIpccCategoryAttrName(year) + ", " 
					+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ",";
		}
		return selectedYears;
	}
	
	@Override
	protected RowMapper<String[]> getRowMapper() {
		return new RowMapper<String[]>() {
			@Override
			public String[] mapRow(ResultSet rs, int rowNum) throws SQLException {
				int columnCount = rs.getMetaData().getColumnCount();
				columnCount++; // adding an extra column with the row number
				String[] columns = new String[ columnCount ];
				columns[0] = "LU_" + String.format("%04d", rs.getRow()) ;
				for (int i = 1; i < columnCount; i++) {
					columns[i] = rs.getString(i);
				}
				return columns;
			}
		};
	}
	
	private List<String[]> generateLUCombinations(int startYear, int endYear) {
		String selectedYears = getGroupingOfStrata(startYear, endYear);

		String sqlSelect = getSqlSelectForStrata(selectedYears);
		
		List<String[]> luData = getJdbcTemplate().query(
					sqlSelect
					, 
					getRowMapper()
				);
		
		// Put the headers of the CSV in the first position of the String list!
		selectedYears= LAND_UNIT_ID + "," + selectedYears; // Add the Land Unit ID which is basically the row number 
		selectedYears+= "area"; // so the area columns appears too
		luData.add( 0, selectedYears.split(",") ); // Add the header row for the CSV output in the first position of the List
		
		return luData;
	}



}
