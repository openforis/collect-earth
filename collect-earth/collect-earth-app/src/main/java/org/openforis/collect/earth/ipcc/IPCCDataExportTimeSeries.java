package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RDBConnector;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.app.service.SchemaService;
import org.openforis.collect.earth.ipcc.model.StratumObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public abstract class IPCCDataExportTimeSeries<E> extends RDBConnector {

	private static final String CLIMATE_COLUMN = "climate";
	private static final String GEZ_COLUMN = "gez";
	private static final String SOIL_COLUMN = "soil";
	
	private static final String CLIMATE_TABLE = "climate_zones_code";
	private static final String CLIMATE_COLUMN_VALUE = "climate_zones";
	private static final String CLIMATE_COLUMN_LABEL = "climate_zones_label";
	private static final String CLIMATE_COLUMN_IN_PLOT = "climate_code_id";
	
	private static final String GEZ_TABLE = "ecological_zones_code";
	private static final String GEZ_COLUMN_VALUE = "ecological_zones";
	private static final String GEZ_COLUMN_LABEL = "ecological_zones_label";
	private static final String GEZ_COLUMN_IN_PLOT = "gez_code_id";
	
	
	private static final String SOIL_TABLE = "soil_types_code";
	private static final String SOIL_COLUMN_VALUE = "soil_types";
	private static final String SOIL_COLUMN_LABEL = "soil_types_label";
	private static final String SOIL_COLUMN_IN_PLOT = "soil_code_id";
	
	private String schemaName;
	private static final String PLOT_TABLE = "plot";

	Logger logger = LoggerFactory.getLogger(IPCCDataExportTimeSeries.class);

	@Autowired
	private SchemaService schemaService;


	public IPCCDataExportTimeSeries() {
		setExportTypeUsed(ExportType.IPCC);
	}

	public File generateTimeseriesData( int startYear, int endYear ) throws IOException {

		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());

		List<StratumObject> strataClimate = getStrataClimate();
		List<StratumObject> strataSoil = getStrataSoil();
		List<StratumObject> strataGEZ = getStrataGEZ();

		List<E> strataData = new ArrayList<E>();

		for (int year = startYear; year < endYear; year++) {
			for (StratumObject gez : strataGEZ) {
				for (StratumObject climate : strataClimate) {
					for (StratumObject soil : strataSoil) {
						E yearLuData = (E) generateLUTimeseriesForStrata(year, gez, climate, soil);
						if (yearLuData != null)
							strataData.add(yearLuData);
					}
				}
			}
		}

		return generateFile( strataData);

	}

	protected abstract File generateFile( List<E> strataData) throws IOException;

	private StratumPerYearData generateLUTimeseriesForStrata(int year, StratumObject gez, StratumObject climate,StratumObject soil) {

		List<LUDataPerYear> luData = getJdbcTemplate().query(
			"select " + IPCCSurveyAdapter.getIpccCategoryAttrName(year)
				+ ", " + IPCCSurveyAdapter.getIpccCategoryAttrName(year + 1) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year + 1) + ", sum( "
				+ RegionCalculationUtils.EXPANSION_FACTOR + ")" 
				+ " from " + schemaName + PLOT_TABLE 
				+ " where " 
				+ CLIMATE_COLUMN + " = " + climate.getValue() + " and " + SOIL_COLUMN + " = " + soil.getValue() + " and " + GEZ_COLUMN + " = " + gez.getValue() 
				+ " GROUP BY "
				+ IPCCSurveyAdapter.getIpccCategoryAttrName(year) + ","
				+ IPCCSurveyAdapter.getIpccCategoryAttrName(year + 1) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year + 1), 
			getRowMapper()
			);

		if (luData.size() == 0) { // No LU data for the climate, soil, gez combination
			return null;
		}

		StratumPerYearData strataPerYearData = new StratumPerYearData(year, climate.getLabel(), soil.getLabel(), gez.getLabel());
		strataPerYearData.setLuData(luData);
		return strataPerYearData;
	}

	protected abstract RowMapper<LUDataPerYear> getRowMapper();

	private List<StratumObject> getStrataGEZ() {
		return distinctValue(CLIMATE_COLUMN_VALUE, CLIMATE_COLUMN_LABEL, CLIMATE_TABLE, CLIMATE_COLUMN_IN_PLOT);
	}

	private List<StratumObject> getStrataSoil() {
		return distinctValue(SOIL_COLUMN_VALUE, SOIL_COLUMN_LABEL, SOIL_TABLE, SOIL_COLUMN_IN_PLOT);
	}

	private List<StratumObject> getStrataClimate() {
		return distinctValue(GEZ_COLUMN_VALUE, GEZ_COLUMN_LABEL, GEZ_TABLE, GEZ_COLUMN_IN_PLOT );
	}

	private List<StratumObject> distinctValue(String valueColumn, String labelColumn, String table, String plotColumnId) {

		return getJdbcTemplate().query(
				"SELECT DISTINCT(" + valueColumn  +"),"+ labelColumn +
				" FROM " + schemaName + table + ", " + schemaName + PLOT_TABLE +
				" WHERE " + PLOT_TABLE + "." + plotColumnId + " = " +  table + "." + table + "_id"
				 , //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
				new RowMapper<StratumObject>() {
					@Override
					public StratumObject mapRow(ResultSet rs, int rowNum) throws SQLException {

						return new StratumObject( rs.getString(valueColumn), rs.getString(labelColumn) );
					}

				});
	}

}
