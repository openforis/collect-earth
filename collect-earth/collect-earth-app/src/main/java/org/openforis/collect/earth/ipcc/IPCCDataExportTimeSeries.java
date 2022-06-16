package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RDBConnector;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.app.service.SchemaService;
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
	private String schemaName;

	Logger logger = LoggerFactory.getLogger(IPCCDataExportTimeSeries.class);

	@Autowired
	private SchemaService schemaService;


	public IPCCDataExportTimeSeries() {
		setExportTypeUsed(ExportType.IPCC);
	}

	public void generateTimeseriesData( File xmlFileDestination, int startYear, int endYear ) {

		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());

		List<String> strataClimate = getStrataClimate();
		List<String> strataSoil = getStrataSoil();
		List<String> strataGEZ = getStrataGEZ();

		List<E> strataData = new ArrayList<E>();

		for (int year = startYear; year < endYear; year++) {
			for (String gez : strataGEZ) {
				for (String climate : strataClimate) {
					for (String soil : strataSoil) {
						E yearLuData = (E) generateLUTimeseriesForStrata(year, gez, climate, soil);
						if (yearLuData != null)
							strataData.add(yearLuData);
					}
				}
			}
		}

		
		generateFile(xmlFileDestination, strataData);

	}

	protected abstract void generateFile(File xmlFileDestination, List<E> strataData);

	private StratumPerYearData generateLUTimeseriesForStrata(int year, String gez, String climate, String soil) {

		List<LUDataPerYear> luData = getJdbcTemplate().query(
			"select " + IPCCSurveyAdapter.getIpccCategoryAttrName(year)
				+ ", " + IPCCSurveyAdapter.getIpccCategoryAttrName(year + 1) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year + 1) + ", sum( "
				+ RegionCalculationUtils.EXPANSION_FACTOR + ")" 
				+ " from " + schemaName + "plot " 
				+ " where " + CLIMATE_COLUMN + " = "
				+ climate + " and " + SOIL_COLUMN + " = " + soil + " and " + GEZ_COLUMN + " = " + gez 
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

		StratumPerYearData strataPerYearData = new StratumPerYearData(year, climate, soil, gez);
		strataPerYearData.setLuData(luData);
		return strataPerYearData;
	}

	protected abstract RowMapper<LUDataPerYear> getRowMapper();

	private List<String> getStrataGEZ() {
		return distinctValue(CLIMATE_COLUMN);
	}

	private List<String> getStrataSoil() {
		return distinctValue(SOIL_COLUMN);
	}

	private List<String> getStrataClimate() {
		return distinctValue(GEZ_COLUMN);
	}

	private List<String> distinctValue(String column) {

		return getJdbcTemplate().query("SELECT DISTINCT(" + column + ") FROM " + schemaName + "plot", //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
				new RowMapper<String>() {
					@Override
					public String mapRow(ResultSet rs, int rowNum) throws SQLException {

						return rs.getString(column);
					}

				});
	}

}
