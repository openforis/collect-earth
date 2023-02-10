package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.math.BigInteger;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;

import org.eclipse.emf.ecore.xml.type.internal.XMLCalendar;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivisionStratified;
import org.openforis.collect.earth.ipcc.model.ManagementType;
import org.openforis.collect.earth.ipcc.model.StratumObject;
import org.openforis.collect.earth.ipcc.serialize.ClimateRegion;
import org.openforis.collect.earth.ipcc.serialize.ClimateRegions;
import org.openforis.collect.earth.ipcc.serialize.CltForestLand;
import org.openforis.collect.earth.ipcc.serialize.ForestLand;
import org.openforis.collect.earth.ipcc.serialize.IPCC2006Export;
import org.openforis.collect.earth.ipcc.serialize.IPCC2006Export.Record;
import org.openforis.collect.earth.ipcc.serialize.LandTypes;
import org.openforis.collect.earth.ipcc.serialize.SoilType;
import org.openforis.collect.earth.ipcc.serialize.SoilTypes;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import com.thoughtworks.xstream.XStream;

import net.lingala.zip4j.ZipFile;

@Component
public class IPCCDataExportTimeSeriesToTool extends AbstractIPCCDataExport{

	@Autowired
	protected IPCCLandUses ipccLandUses;

	public File generateTimeseriesData(int startYear, int endYear, String countryCode) throws IOException {
		initSchemaName();

		File zipFileWithInventoryData = File.createTempFile("ghgi_timeseries_ipcc_tool", ".zip");
		zipFileWithInventoryData.deleteOnExit();
		
		for (int year = startYear; year < endYear; year++) {

			IPCC2006Export ipcc2006Export = new IPCC2006Export();
			ipcc2006Export.setCountryCode(countryCode);
			ipcc2006Export.setVersion("2.83");
			ipcc2006Export.setInventoryYear(new XMLCalendar(year + "", XMLCalendar.GYEAR));

			Record record = new Record();
			LandTypes landTypes = new LandTypes();

			addClimateRegions(landTypes);
			addSoilTypes(landTypes);
			addForestLand(landTypes, year);

			record.setLandTypes(landTypes);
			ipcc2006Export.getRecord().add(record);

			File ipccInventroyYearTemp = generateXMLFile(ipcc2006Export, year);
			CollectEarthUtils.addFileToZip(zipFileWithInventoryData, ipccInventroyYearTemp,
					"ipcc_reporting_lulucf_" + year + ".xml");
		}

		return zipFileWithInventoryData;

	}

	private void addForestLand(LandTypes landTypes, int year) {
		ForestLand forestLand = new ForestLand();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.F, year);
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltForestLand cltForestLand = new CltForestLand();
			cltForestLand.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltForestLand.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltForestLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltForestLand.setManaged(landUseSubdivisionStratified.getLandUseSubdivision().getType().equals(ManagementType.MANAGED));
		}
		landTypes.setForestLand(forestLand);
	}

	private void addSoilTypes(LandTypes landTypes) {
		SoilTypes soilTypes = new SoilTypes();
		for (StratumObject soil : getStrataSoil()) {
			SoilType soilType = new SoilType();
			soilType.setGuid(UUID.randomUUID().toString());
			soilType.setId(BigInteger.valueOf(Long.parseLong(soil.getValue())));
			soilType.setRemark(soil.getValue());
			soilTypes.getSoilType().add(soilType);
		}
		landTypes.setSoilTypes(soilTypes);
	}

	private void addClimateRegions(LandTypes landTypes) {
		ClimateRegions climateRegions = new ClimateRegions();
		for (StratumObject climate : getStrataClimate()) {
			ClimateRegion climateRegion = new ClimateRegion();
			climateRegion.setGuid(UUID.randomUUID().toString());
			climateRegion.setId(BigInteger.valueOf(Long.parseLong(climate.getValue())));
			climateRegion.setRemark(climate.getValue());
			climateRegions.getClimateRegion().add(climateRegion);
		}
		landTypes.setClimateRegions(climateRegions);
	}

	private List<LandUseSubdivisionStratified<?>> getClimateSoilLandUseCombination(LandUseCategory luCategory, int year) {

		return getJdbcTemplate().query(

				"select " + "DISTINCT " + IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ", " + CLIMATE_COLUMN
						+ ", " + SOIL_COLUMN 
						// + ", "+ GEZ_COLUMN
						+ " from " + getSchemaName() + PLOT_TABLE + " where "
						+ IPCCSurveyAdapter.getIpccCategoryAttrName(year) + " = '" + luCategory.getCode() + "'"

				,

				new RowMapper<LandUseSubdivisionStratified<?>>() {
					@Override
					public LandUseSubdivisionStratified mapRow(ResultSet rs, int rowNum) throws SQLException {

						String landUseSubdivision = rs.getString(1);
						LandUseSubdivision<?> luSubItem = ipccLandUses.getLandUseSubdivisions().stream()
								.filter(luSubElem -> luSubElem.getCode().equals(landUseSubdivision))
								.findFirst()
								.orElseThrow(() -> new IllegalArgumentException("No LU Subdivisions found for " + landUseSubdivision));

						Integer climateCode = rs.getInt(2);
						StratumObject climateItem = getStrataClimate().stream()
								.filter(climElem -> Integer.valueOf(climElem.getValue()).equals(climateCode))
								.findFirst()
								.orElseThrow(() -> new IllegalArgumentException("No Climate found for " + climateCode));

						Integer soilCode = rs.getInt(3);
						StratumObject soilItem = getStrataSoil().stream()
								.filter(soilElem -> Integer.valueOf(soilElem.getValue()).equals(soilCode)).findFirst()
								.orElseThrow(() -> new IllegalArgumentException("No Soil found for " + soilCode));

						// Integer gz = rs.getInt(4);

						return new LandUseSubdivisionStratified(luCategory, luSubItem, climateItem, soilItem);
					}

				});

	}

	protected File generateXMLFile(IPCC2006Export ipcc2006Export, int year) throws IOException {
		File xmlFileDestination = File.createTempFile("ghgiActivityData_" + year, ".xml");
		xmlFileDestination.deleteOnExit();
		XStream xStream = new XStream();
		xStream.setMode(XStream.NO_REFERENCES);

		String xmlSchema = xStream.toXML(ipcc2006Export);

		try (FileOutputStream outputStream = new FileOutputStream(xmlFileDestination)) {
			byte[] strToBytes = xmlSchema.getBytes();
			outputStream.write(strToBytes);
		} catch (Exception e) {
			logger.error("Error saving data to file", e);
		}

		return xmlFileDestination;
	}

}
