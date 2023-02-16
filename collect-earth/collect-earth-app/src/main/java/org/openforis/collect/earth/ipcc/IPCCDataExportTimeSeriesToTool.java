package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.math.BigInteger;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

import javax.xml.bind.JAXBContext;
import javax.xml.bind.JAXBException;
import javax.xml.bind.Marshaller;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.ipcc.model.CroplandType;
import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivisionStratified;
import org.openforis.collect.earth.ipcc.model.ManagementType;
import org.openforis.collect.earth.ipcc.model.StratumObject;
import org.openforis.collect.earth.ipcc.serialize.ClimateRegion;
import org.openforis.collect.earth.ipcc.serialize.ClimateRegions;
import org.openforis.collect.earth.ipcc.serialize.CltCropland;
import org.openforis.collect.earth.ipcc.serialize.CltForestLand;
import org.openforis.collect.earth.ipcc.serialize.CltGrassland;
import org.openforis.collect.earth.ipcc.serialize.CltSettlement;
import org.openforis.collect.earth.ipcc.serialize.CltWetland;
import org.openforis.collect.earth.ipcc.serialize.Cropland;
import org.openforis.collect.earth.ipcc.serialize.ForestLand;
import org.openforis.collect.earth.ipcc.serialize.Grassland;
import org.openforis.collect.earth.ipcc.serialize.IPCC2006Export;
import org.openforis.collect.earth.ipcc.serialize.IPCC2006Export.Record;
import org.openforis.collect.earth.ipcc.serialize.LandTypes;
import org.openforis.collect.earth.ipcc.serialize.ObjectFactory;
import org.openforis.collect.earth.ipcc.serialize.Settlement;
import org.openforis.collect.earth.ipcc.serialize.SoilType;
import org.openforis.collect.earth.ipcc.serialize.SoilTypes;
import org.openforis.collect.earth.ipcc.serialize.Wetland;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class IPCCDataExportTimeSeriesToTool extends AbstractIPCCDataExport {

	@Autowired
	protected IPCCLandUses ipccLandUses;

	private void addClimateRegions(LandTypes landTypes) {
		ClimateRegions climateRegions = new ClimateRegions();
		for (StratumObject climate : getStrataClimate()) {
			ClimateRegion climateRegion = new ClimateRegion();
			climateRegion.setGuid(climate.getGuid());
			climateRegion.setId(BigInteger.valueOf(Long.parseLong(climate.getValue())));
			climateRegion.setRemark(climate.getLabel());
			climateRegions.getClimateRegion().add(climateRegion);
		}
		landTypes.setClimateRegions(climateRegions);
	}

	private void addCropland(LandTypes landTypes, int year) {
		Cropland cropLand = new Cropland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.C, year);
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltCropland cltCropLand = new CltCropland();
			cltCropLand.setGuid(landUseSubdivisionStratified.getLandUseSubdivision().getGuid());
			cltCropLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltCropLand.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltCropLand.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltCropLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltCropLand.setPerennialCrops(
					landUseSubdivisionStratified.getLandUseSubdivision().getType().equals(CroplandType.PERENNIAL));
			cropLand.getCltCropland().add(cltCropLand);
		}
		landTypes.setCropland(cropLand);
	}

	private void addForestland(LandTypes landTypes, int year) {
		ForestLand forestLand = new ForestLand();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.F, year);
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltForestLand cltForestLand = new CltForestLand();
			cltForestLand.setGuid(landUseSubdivisionStratified.getLandUseSubdivision().getGuid());
			cltForestLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltForestLand.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltForestLand.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltForestLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltForestLand.setManaged(
					landUseSubdivisionStratified.getLandUseSubdivision().getType().equals(ManagementType.MANAGED));
			forestLand.getCltForestLand().add(cltForestLand);
		}
		landTypes.setForestLand(forestLand);
	}

	private void addGrassland(LandTypes landTypes, int year) {
		Grassland grassLand = new Grassland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.G, year);
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltGrassland cltGrassLand = new CltGrassland();
			cltGrassLand.setGuid(landUseSubdivisionStratified.getLandUseSubdivision().getGuid());
			cltGrassLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltGrassLand.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltGrassLand.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltGrassLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltGrassLand.setManaged(
					landUseSubdivisionStratified.getLandUseSubdivision().getType().equals(ManagementType.MANAGED));
			grassLand.getCltGrassland().add(cltGrassLand);
		}
		landTypes.setGrassland(grassLand);
	}

	private void addSettlement(LandTypes landTypes, int year) {
		Settlement settlement = new Settlement();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.S, year);
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltSettlement cltSettlement = new CltSettlement();
			cltSettlement.setGuid(landUseSubdivisionStratified.getLandUseSubdivision().getGuid());
			cltSettlement.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltSettlement.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltSettlement.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltSettlement.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());

			/*
			 * cltSettlement.set(
			 * landUseSubdivisionStratified.getLandUseSubdivision().getType().equals(
			 * SettlementType.TREED ));
			 */
			settlement.getCltSettlement().add(cltSettlement);
		}
		landTypes.setSettlement(settlement);
	}

	private void addSoilTypes(LandTypes landTypes) {
		SoilTypes soilTypes = new SoilTypes();
		for (StratumObject soil : getStrataSoil()) {
			SoilType soilType = new SoilType();
			soilType.setGuid(soil.getGuid());
			soilType.setId(Integer.valueOf(soil.getValue()));
			soilType.setRemark(soil.getLabel());
			soilTypes.getSoilType().add(soilType);
		}
		landTypes.setSoilTypes(soilTypes);
	}

	private void addWetland(LandTypes landTypes, int year) {
		Wetland wetland = new Wetland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.S, year);
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltWetland cltWetland = new CltWetland();
			cltWetland.setGuid(landUseSubdivisionStratified.getLandUseSubdivision().getGuid());
			cltWetland.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltWetland.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltWetland.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltWetland.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());

			/*
			 * cltSettlement.set(
			 * landUseSubdivisionStratified.getLandUseSubdivision().getType().equals(
			 * SettlementType.TREED ));
			 */
			wetland.getCltWetland().add(cltWetland);
		}
		landTypes.setWetland(wetland);
	}

	public File generateTimeseriesData(int startYear, int endYear, String countryCode) throws IOException {
		initSchemaName();

		File zipFileWithInventoryData = new File("ghgi_timeseries_ipcc_tool.zip");
		zipFileWithInventoryData.deleteOnExit();

		for (int year = startYear; year < endYear; year++) {
			IPCC2006Export ipcc2006Export = new IPCC2006Export();
			ipcc2006Export.setCountryCode(countryCode);
			ipcc2006Export.setVersion("2.83");
			ipcc2006Export.setInventoryYear(year);

			Record record = new Record();
			LandTypes landTypes = new LandTypes();

			addClimateRegions(landTypes);
			addSoilTypes(landTypes);

			addForestland(landTypes, year);
			addCropland(landTypes, year);
			addGrassland(landTypes, year);
			addSettlement(landTypes, year);
			addWetland(landTypes, year);

			record.setLandTypes(landTypes);
			ipcc2006Export.getRecord().add(record);

			File ipccInventroyYearTemp = generateXMLFile(ipcc2006Export, year);
			CollectEarthUtils.addFileToZip(zipFileWithInventoryData, ipccInventroyYearTemp,
					"ipcc_reporting_lulucf_" + year + ".xml");
			ipccInventroyYearTemp.delete();
		}

		return zipFileWithInventoryData;

	}

	protected File generateXMLFile(IPCC2006Export ipcc2006Export, int year) throws IOException {
		File xmlFileDestination = new File("ghgiActivityData_" + year + ".xml");
		xmlFileDestination.deleteOnExit();

		JAXBContext jc;

		try {
			jc = JAXBContext.newInstance(ObjectFactory.class.getPackage().getName(),
					ObjectFactory.class.getClassLoader());
			Marshaller m = jc.createMarshaller();
			m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.TRUE);
			try (OutputStream os = new FileOutputStream(xmlFileDestination)) {
				m.marshal(ipcc2006Export, os);
			}
		} catch (JAXBException e1) {
			logger.error("Error marshalling data ", e1);
		}

		return xmlFileDestination;
	}

	private List<LandUseSubdivisionStratified<?>> getClimateSoilLandUseCombination(LandUseCategory luCategory,
			int year) {

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
								.filter(luSubElem -> luSubElem.getCode().equals(landUseSubdivision)).findFirst()
								.orElseThrow(() -> new IllegalArgumentException(
										"No LU Subdivisions found for " + landUseSubdivision));

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

}
