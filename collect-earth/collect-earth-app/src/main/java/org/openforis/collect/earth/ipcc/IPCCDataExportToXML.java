package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileOutputStream;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.RDBConnector;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.app.service.SchemaService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import com.thoughtworks.xstream.XStream;

@Component
public class IPCCDataExportToXML extends RDBConnector {

	private static final String CLIMATE_COLUMN = "climate";
	private static final String GEZ_COLUMN = "gez";
	private static final String SOIL_COLUMN = "soil";
	private String schemaName;

	private Logger logger = LoggerFactory.getLogger(IPCCDataExportToXML.class);

	@Autowired
	private SchemaService schemaService;


	public IPCCDataExportToXML() {
		setExportTypeUsed(ExportType.IPCC);
	}

	public void generateTimeseriesXML( File xmlFileDestination ) {

		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());

		List<String> strataClimate = getStrataClimate();
		List<String> strataSoil = getStrataSoil();
		List<String> strataGEZ = getStrataGEZ();

		List<StratumPerYearData> strataData = new ArrayList<StratumPerYearData>();

		for (int year = IPCCGenerator.START_YEAR; year < IPCCGenerator.END_YEAR; year++) {
			for (String gez : strataGEZ) {
				for (String climate : strataClimate) {
					for (String soil : strataSoil) {
						StratumPerYearData yearLuData = generateLUTimeseriesForStrata(year, gez, climate, soil);
						if (yearLuData != null)
							strataData.add(yearLuData);
					}
				}
			}
		}

		XStream xStream = new XStream();
		xStream.alias("LandUse", LUDataPerYear.class);
		xStream.alias("Stratum", StratumPerYearData.class);
		String xmlSchema = xStream.toXML(strataData);
		System.out.println(xmlSchema);
		
		try (FileOutputStream outputStream = new FileOutputStream( xmlFileDestination ) ) {
			// Java 11 , default StandardCharsets.UTF_8

			byte[] strToBytes = xmlSchema.getBytes();
			outputStream.write(strToBytes);

		} catch (Exception e) {
			logger.error("Error saving data to file", e);
		}
		
		CollectEarthUtils.openFile( xmlFileDestination);

	}

	private StratumPerYearData generateLUTimeseriesForStrata(int year, String gez, String climate, String soil) {

		List<LUDataPerYear> luData = getJdbcTemplate().query("select " + IPCCSurveyAdapter.getIpccCategoryAttrName(year)
				+ ", " + IPCCSurveyAdapter.getIpccCategoryAttrName(year + 1) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year + 1) + ", sum( "
				+ RegionCalculationUtils.EXPANSION_FACTOR + ")" + " from plot " + " where " + CLIMATE_COLUMN + " = "
				+ climate + " and " + SOIL_COLUMN + " = " + soil + " and " + GEZ_COLUMN + " = " + gez + " GROUP BY "
				+ IPCCSurveyAdapter.getIpccCategoryAttrName(year) + ","
				+ IPCCSurveyAdapter.getIpccCategoryAttrName(year + 1) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ","
				+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year + 1), new RowMapper<LUDataPerYear>() {
					@Override
					public LUDataPerYear mapRow(ResultSet rs, int rowNum) throws SQLException {

						return new LUDataPerYear(rs.getString(1), // cat year
								rs.getString(2), // cat year+1
								rs.getString(3), // subdivision year
								rs.getString(4), // subdivision year + 1
								rs.getDouble(5) // area
						);

					}

				});

		if (luData.size() == 0) { // No LU data for the climate, soil, gez combination
			return null;
		}

		StratumPerYearData strataPerYearData = new StratumPerYearData(year, climate, soil, gez);
		strataPerYearData.setLuData(luData);
		return strataPerYearData;
	}

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
