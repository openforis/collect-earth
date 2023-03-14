package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import javax.xml.bind.JAXBContext;
import javax.xml.bind.JAXBException;
import javax.xml.bind.Marshaller;

import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.CroplandType;
import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.LandUseManagement;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivisionStratified;
import org.openforis.collect.earth.ipcc.model.ManagementType;
import org.openforis.collect.earth.ipcc.model.SettlementType;
import org.openforis.collect.earth.ipcc.model.StratumObject;
import org.openforis.collect.earth.ipcc.serialize.ClimateRegion;
import org.openforis.collect.earth.ipcc.serialize.ClimateRegions;
import org.openforis.collect.earth.ipcc.serialize.CltCropland;
import org.openforis.collect.earth.ipcc.serialize.CltForestLand;
import org.openforis.collect.earth.ipcc.serialize.CltGrassland;
import org.openforis.collect.earth.ipcc.serialize.CltOtherland;
import org.openforis.collect.earth.ipcc.serialize.CltSettlement;
import org.openforis.collect.earth.ipcc.serialize.CltWetland;
import org.openforis.collect.earth.ipcc.serialize.Cropland;
import org.openforis.collect.earth.ipcc.serialize.ForestLand;
import org.openforis.collect.earth.ipcc.serialize.Grassland;
import org.openforis.collect.earth.ipcc.serialize.IPCC2006Export;
import org.openforis.collect.earth.ipcc.serialize.IPCC2006Export.Record;
import org.openforis.collect.earth.ipcc.serialize.LandRepresentation;
import org.openforis.collect.earth.ipcc.serialize.LandTypes;
import org.openforis.collect.earth.ipcc.serialize.LrtCountry;
import org.openforis.collect.earth.ipcc.serialize.LrtLandCategory;
import org.openforis.collect.earth.ipcc.serialize.LrtLandSubcategory;
import org.openforis.collect.earth.ipcc.serialize.LrtLandSubdivision;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnit;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnitArea;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnitHistory;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnitHistoryRecord;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnits;
import org.openforis.collect.earth.ipcc.serialize.LrtRegion;
import org.openforis.collect.earth.ipcc.serialize.LrtRegions;
import org.openforis.collect.earth.ipcc.serialize.ObjectFactory;
import org.openforis.collect.earth.ipcc.serialize.Otherland;
import org.openforis.collect.earth.ipcc.serialize.Settlement;
import org.openforis.collect.earth.ipcc.serialize.SoilType;
import org.openforis.collect.earth.ipcc.serialize.SoilTypes;
import org.openforis.collect.earth.ipcc.serialize.Wetland;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class IPCCDataExportTimeSeriesToTool extends AbstractIPCCDataExport {

	private static final String XSL_VERSION = "2.85";

	private static final String AREAS_SUM = "AREAS_SUM";

	@Autowired
	protected IPCCLandUses ipccLandUses;

	private String countryCode;

	private LandTypes landTypes;

	private List<LandUseSubdivisionStratified<?>> subdivisionsStrata;

	private int startYear;

	private int endYear;

	private RegionColumn stratifyByRegion;

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

	private void addClimateRegions(LandTypes landTypes) {
		ClimateRegions climateRegions = new ClimateRegions();
		for (StratumObject climate : getStrataClimate()) {
			ClimateRegion climateRegion = new ClimateRegion();
			climateRegion.setGuid(climate.getGuid());
			climateRegion.setId(Integer.parseInt(climate.getValue()));
			climateRegion.setRemark(climate.getLabel());
			climateRegions.getClimateRegion().add(climateRegion);
		}
		landTypes.setClimateRegions(climateRegions);
	}

	private void addCropland(LandTypes landTypes) {
		Cropland cropLand = new Cropland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.C);

		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltCropland cltCropLand = new CltCropland();
			cltCropLand.setId(landUseSubdivisionStratified.getId());
			cltCropLand.setGuid(landUseSubdivisionStratified.getGuid());
			cltCropLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltCropLand.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltCropLand.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltCropLand.setPerennialCrops(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType()
					.equals(CroplandType.PERENNIAL));
			cltCropLand.setCountryCode(getCountryCode());
			cropLand.getCltCropland().add(cltCropLand);
		}
		landTypes.setCropland(cropLand);
	}

	private void addForestland(LandTypes landTypes) {
		ForestLand forestLand = new ForestLand();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.F);

		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltForestLand cltForestLand = new CltForestLand();
			cltForestLand.setId(landUseSubdivisionStratified.getId());
			cltForestLand.setGuid(landUseSubdivisionStratified.getGuid());
			cltForestLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltForestLand.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltForestLand.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltForestLand.setManaged(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType()
					.equals(ManagementType.MANAGED));
			cltForestLand.setCountryCode(getCountryCode());
			forestLand.getCltForestLand().add(cltForestLand);
		}
		landTypes.setForestLand(forestLand);
	}

	private void addGrassland(LandTypes landTypes) {
		Grassland grassLand = new Grassland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.G);

		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltGrassland cltGrassLand = new CltGrassland();
			cltGrassLand.setId(landUseSubdivisionStratified.getId());
			cltGrassLand.setGuid(landUseSubdivisionStratified.getGuid());
			cltGrassLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltGrassLand.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltGrassLand.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltGrassLand.setManaged(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType()
					.equals(ManagementType.MANAGED));
			cltGrassLand.setCountryCode(getCountryCode());
			grassLand.getCltGrassland().add(cltGrassLand);
		}
		landTypes.setGrassland(grassLand);
	}

	private void addSettlement(LandTypes landTypes) {
		Settlement settlement = new Settlement();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.S);

		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltSettlement cltSettlement = new CltSettlement();
			cltSettlement.setId(landUseSubdivisionStratified.getId());
			cltSettlement.setGuid(landUseSubdivisionStratified.getGuid());
			cltSettlement.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltSettlement.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltSettlement.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltSettlement.setCountryCode(getCountryCode());

			cltSettlement.setSettlementTypeId(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType()
					.equals(SettlementType.TREED) ? 1 : 2);

			settlement.getCltSettlement().add(cltSettlement);
		}
		landTypes.setSettlement(settlement);
	}

	private void addWetland(LandTypes landTypes) {
		Wetland wetland = new Wetland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.W);
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltWetland cltWetland = new CltWetland();
			cltWetland.setId(landUseSubdivisionStratified.getId());
			cltWetland.setGuid(landUseSubdivisionStratified.getGuid());
			cltWetland.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltWetland.setClimateRegionId(Integer.parseInt(landUseSubdivisionStratified.getClimate().getValue()));
			cltWetland.setSoilTypeId(Integer.parseInt(landUseSubdivisionStratified.getSoil().getValue()));
			cltWetland.setCountryCode(getCountryCode());
			/*
			 * cltSettlement.set(
			 * landUseSubdivisionStratified.getLandUseSubdivision().getType().equals(
			 * SettlementType.TREED ));
			 */
			wetland.getCltWetland().add(cltWetland);
		}
		landTypes.setWetland(wetland);
	}

	private void addOtherland(LandTypes landTypes) {
		Otherland otherland = new Otherland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategory.O);

		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltOtherland cltOtherland = new CltOtherland();
			cltOtherland.setId(landUseSubdivisionStratified.getId());
			cltOtherland.setGuid(landUseSubdivisionStratified.getGuid());
			cltOtherland.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getName());
			cltOtherland.setManaged(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType()
					.equals(ManagementType.MANAGED));
			cltOtherland.setCountryCode(getCountryCode());
			otherland.getCltOtherland().add(cltOtherland);
		}
		landTypes.setOtherland(otherland);
	}

	public File generateTimeseriesData(int inventoryYear, int startYear, int endYear, String countryCode,
			RegionColumn stratifyByRegion) throws IOException {
		
		this.startYear = startYear;
		this.endYear = endYear;
		this.setCountryCode(countryCode);
		this.setStratifyByRegion(stratifyByRegion);
		
		initSchemaName();

		setSubdivisionsStrata(new ArrayList<LandUseSubdivisionStratified<?>>());

		File zipFileWithInventoryData = new File("ghgi_timeseries_ipcc_tool.xml");
		zipFileWithInventoryData.deleteOnExit();

		IPCC2006Export ipcc2006Export = new IPCC2006Export();
		ipcc2006Export.setCountryCode(getCountryCode());
		ipcc2006Export.setVersion(XSL_VERSION);
		ipcc2006Export.setInventoryYear(inventoryYear);

		Record record = new Record();

		setLandTypes(new LandTypes());
		addClimateAndSoil(getLandTypes());
		addLandClasses(getLandTypes());

		LandRepresentation landRepresentation = new LandRepresentation();
		LrtCountry lrtCountry = new LrtCountry();
		lrtCountry.setCountryCode(getCountryCode());
		lrtCountry.setArea(getTotalArea());
		lrtCountry.setRegions(getLrtRegions());

		landRepresentation.setLrtCountry(lrtCountry);

		getLandTypes().setLandRepresentation(landRepresentation);

		record.setLandTypes(getLandTypes());

		ipcc2006Export.getRecord().add(record);

		File ipccInventroyYearTemp = generateXMLFile(ipcc2006Export);

		return ipccInventroyYearTemp;

	}

	private LrtRegions getLrtRegions() {
		LrtRegions regions = new LrtRegions();

		// Collect the regions in the country
		Collection<LrtRegion> regionList = getJdbcTemplate().query(

				"select " + getStratifyByRegion().getColumnName() + ", SUM(" + RegionCalculationUtils.EXPANSION_FACTOR
						+ ") " + " from " + getSchemaName() + PLOT_TABLE + " GROUP BY "
						+ getStratifyByRegion().getColumnName(),

				new RowMapper<LrtRegion>() {
					@Override
					public LrtRegion mapRow(ResultSet rs, int rowNum) throws SQLException {

						String regionName = rs.getString(1);
						Double area = rs.getDouble(2);

						LrtRegion lrtRegion = new LrtRegion();
						lrtRegion.setArea(area);
						lrtRegion.setName(regionName);

						// lrtRegion.setLandCategories( getLandCategories( RegionColumn
						// stratifyByRegionColumn, String name, Integer year ));

						return lrtRegion;
					}

				});

		// Add the land categories to the regions

		for (LrtRegion lrtRegion : regionList) {
			addLandCategoriesToRegion(lrtRegion);
		}

		regions.getLrtRegion().addAll(regionList);
		return regions;
	}

	private void addLandCategoriesToRegion(LrtRegion lrtRegion) {
		for (LandUseCategory landUseCat : LandUseCategory.values()) {
			LrtLandCategory landCategory = new LrtLandCategory();
			landCategory.setLtId(landUseCat.getId());
			Collection<? extends LrtLandSubcategory> landSubcategories = getLandSubcategories(lrtRegion, landUseCat);
			if (landSubcategories.size() > 0) {
				landCategory.getLandSubcategories().getLrtLandSubcategory().addAll(landSubcategories);
				lrtRegion.getLandCategories().getLrtLandCategory().add(landCategory);
			}
		}
	}

	private Collection<? extends LrtLandSubcategory> getLandSubcategories(LrtRegion lrtRegion,
			LandUseCategory landUseCat) {

		Collection<LrtLandSubcategory> lartLandUseSubcategory = new ArrayList<LrtLandSubcategory>();
		for (LandUseManagement landUseManagement : LandUseManagement.find(landUseCat)) {

			LrtLandSubcategory lrtSubcategory = new LrtLandSubcategory();

			lrtSubcategory.setScatId(landUseManagement.getId());
			Collection<? extends LrtLandSubdivision> lrtLandSubdivisions = getLrtLandSubdivisions(lrtRegion,
					landUseManagement);
			if (lrtLandSubdivisions.size() > 0) {
				lrtSubcategory.getLandSubdivisions().getLrtLandSubdivision().addAll(lrtLandSubdivisions);
				lartLandUseSubcategory.add(lrtSubcategory);
			}

		}
		return lartLandUseSubcategory;
	}

	private Collection<? extends LrtLandSubdivision> getLrtLandSubdivisions(LrtRegion lrtRegion,
			LandUseManagement landUseManagement) {

		List<LrtLandSubdivision> subdivisionsList = new ArrayList<LrtLandSubdivision>();

		for (LandUseSubdivisionStratified<?> landUseSubdivisionStratified : getSubdivisionsStrata()) {

			if (landUseSubdivisionStratified.getLandUseSubdivision().getManagementType()
					.equals(landUseManagement.getManagementType())
					&& landUseSubdivisionStratified.getLandUseCategory().equals(landUseManagement.getLuCategory())) {

				LrtLandSubdivision subdvision = new LrtLandSubdivision();
				subdvision.setCltId(landUseSubdivisionStratified.getId());
				LrtLandUnits landUnits = new LrtLandUnits();

				List<LrtLandUnit> landUnitsForStrataAndRegion = generateLandUnits(lrtRegion,
						landUseSubdivisionStratified);
				if (landUnitsForStrataAndRegion.size() > 0) {
					landUnits.getLrtLandUnit().addAll(landUnitsForStrataAndRegion);
					subdvision.setLandUnits(landUnits);
					subdivisionsList.add(subdvision);
				}
			}
		}
		return subdivisionsList;
	}

	protected RowMapper<LrtLandUnit> getLandUnitsRowMapper(
			LandUseSubdivisionStratified<?> landUseSubdivisionStratified) {
		return new RowMapper<LrtLandUnit>() {
			@Override
			public LrtLandUnit mapRow(ResultSet rs, int rowNum) throws SQLException {

				String subcategory = rs.getString(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBCATEGORY);
				Integer subcategoryYearChange = rs.getInt(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED);
				String subdivision = rs.getString(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION);
				Integer subdivisionYearChange = rs.getInt(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED);
				String secondLUConversion = rs.getString(IPCCSurveyAdapter.TEMPLATE_SECOND_LU_CONVERSION);
				Integer secondLUConversionYear = rs.getInt(IPCCSurveyAdapter.TEMPLATE_SECOND_LU_CONVERSION_YEAR);
				String secondLUSubdivision = rs.getString(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SECOND_SUBDIVISION);

				LrtLandUnit landUnit = new LrtLandUnit();

				if (subcategory.substring(0, 1).equals(subcategory.substring(1, 2))) {
					if (subdivisionYearChange != null && subdivisionYearChange > -1) {
						landUnit.setConvYear(subdivisionYearChange);
						landUnit.setLtIdPrev(landUseSubdivisionStratified.getLandUseCategory().getId());
						landUnit.setCltIdPrev(LandUseSubdivisionUtils.getSubdivision(
								landUseSubdivisionStratified.getLandUseCategory().getCode(), subdivision).getId());
					} else {
						landUnit.setConvYear(-2);
						landUnit.setLtIdPrev(-200);
						landUnit.setCltIdPrev(-200);
					}
				} else {
					landUnit.setConvYear(subcategoryYearChange);
					landUnit.setLtIdPrev(landUseSubdivisionStratified.getLandUseCategory().getId());
					landUnit.setCltIdPrev(landUseSubdivisionStratified.getLandUseSubdivision().getId());

					if (secondLUConversion != null && !secondLUConversion.equals("-1")) {
						LrtLandUnitHistory landUnitHistory = new LrtLandUnitHistory();

						String luSencondCategory = secondLUConversion.substring(0, 1); // The conversion would be FC (
																						// initial land use would be F)
						LandUseCategory luInitial = LandUseCategory.valueOf(luSencondCategory);
						LandUseSubdivision<?> subdivisionInitial = LandUseSubdivisionUtils
								.getSubdivision(luInitial.getCode(), secondLUSubdivision);

						LrtLandUnitHistoryRecord lrtLandUnitHistoryRecord = new LrtLandUnitHistoryRecord();
						lrtLandUnitHistoryRecord.setLtIdPrev(luInitial.getId());
						lrtLandUnitHistoryRecord.setCltIdPrev(subdivisionInitial.getId());
						lrtLandUnitHistoryRecord.setConvYear(secondLUConversionYear);

						landUnitHistory.getLrtLandUnitHistoryRecord().add(lrtLandUnitHistoryRecord);
						landUnit.setHistory(landUnitHistory);
					}

				}

				LrtLandUnit.Areas areas = new LrtLandUnit.Areas();

				LrtLandUnitArea lrtLandUnitArea = new LrtLandUnitArea();
				lrtLandUnitArea.setValue(rs.getDouble(AREAS_SUM));

				areas.getArea().add(lrtLandUnitArea);

				landUnit.setAreas(areas);
				return landUnit;
			}
		};
	}

	private List<LrtLandUnit> generateLandUnits(LrtRegion lrtRegion,
			LandUseSubdivisionStratified<?> landUseSubdivisionStratified) {

		String sqlGrouping = IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBCATEGORY + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED + ", "
				+ IPCCSurveyAdapter.TEMPLATE_SECOND_LU_CONVERSION + ", "
				+ IPCCSurveyAdapter.TEMPLATE_SECOND_LU_CONVERSION_YEAR + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_SECOND_SUBDIVISION + ",";

		String sqlSelect = "select " + sqlGrouping + " sum( " + RegionCalculationUtils.EXPANSION_FACTOR + ") AS "
				+ AREAS_SUM + " FROM " + PLOT_TABLE + " where " + SOIL + " = "
				+ landUseSubdivisionStratified.getSoil().getValue() + " and " + CLIMATE + " = "
				+ landUseSubdivisionStratified.getClimate().getValue() + " and "
				+ IPCCSurveyAdapter.ATTR_CURRENT_CATEGORY + " = '"
				+ landUseSubdivisionStratified.getLandUseCategory().getCode() + "' " + " and "
				+ IPCCSurveyAdapter.ATTR_CURRENT_SUBDIVISION + " = '"
				+ landUseSubdivisionStratified.getLandUseSubdivision().getCode() + "' " + " and "
				+ getStratifyByRegion().getColumnName() + " = '" + lrtRegion.getName() + "' "

				+ " GROUP BY " + sqlGrouping.substring(0, sqlGrouping.length() - 1) + " ORDER BY " + AREAS_SUM
				+ " DESC";

		List<LrtLandUnit> luData = getJdbcTemplate().query(sqlSelect,
				getLandUnitsRowMapper(landUseSubdivisionStratified));

		return luData;
	}

	private Double getTotalArea() {
		return getJdbcTemplate().queryForObject("select SUM(" + RegionCalculationUtils.EXPANSION_FACTOR + ") "
				+ " from " + getSchemaName() + PLOT_TABLE, Double.class);
	}

	private void addClimateAndSoil(LandTypes landTypes) {
		addClimateRegions(landTypes);
		addSoilTypes(landTypes);
	}

	private void addLandClasses(LandTypes landTypes) {
		addForestland(landTypes);
		addCropland(landTypes);
		addGrassland(landTypes);
		addSettlement(landTypes);
		addWetland(landTypes);
		addOtherland(landTypes);
	}

	protected File generateXMLFile(IPCC2006Export ipcc2006Export) throws IOException {
		File xmlFileDestination = new File("ImportIntoGHGiTool.xml");
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

	private List<LandUseSubdivisionStratified<?>> getClimateSoilLandUseCombination(LandUseCategory luCategory) {

		List<LandUseSubdivisionStratified<?>> substratasInYear = getJdbcTemplate().query(

				"select " + "DISTINCT " + IPCCSurveyAdapter.ATTR_CURRENT_SUBDIVISION + ", " + CLIMATE_COLUMN + ", "
						+ SOIL_COLUMN // + ", "+ GEZ_COLUMN
						+ " from " + getSchemaName() + PLOT_TABLE + " where " + IPCCSurveyAdapter.ATTR_CURRENT_CATEGORY
						+ " = '" + luCategory.getCode() + "'",

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

						Integer seqId = rowNum + 1;

						return new LandUseSubdivisionStratified(luCategory, luSubItem, climateItem, soilItem, seqId);
					}

				});

		// Put these values into a variable so that we can use the same IDs later!
		substratasInYear.addAll(substratasInYear);

		return substratasInYear;
	}

	private String getCountryCode() {
		return countryCode;
	}

	private void setCountryCode(String countryCode) {
		this.countryCode = countryCode;
	}

	private LandTypes getLandTypes() {
		return landTypes;
	}

	private void setLandTypes(LandTypes landTypes) {
		this.landTypes = landTypes;
	}

	private IPCCLandUses getIpccLandUses() {
		return ipccLandUses;
	}

	private List<LandUseSubdivisionStratified<?>> getSubdivisionsStrata() {
		return subdivisionsStrata;
	}

	private int getStartYear() {
		return startYear;
	}

	private int getEndYear() {
		return endYear;
	}

	private RegionColumn getStratifyByRegion() {
		return stratifyByRegion;
	}

	private void setIpccLandUses(IPCCLandUses ipccLandUses) {
		this.ipccLandUses = ipccLandUses;
	}

	private void setSubdivisionsStrata(List<LandUseSubdivisionStratified<?>> subdivisionsStrata) {
		this.subdivisionsStrata = subdivisionsStrata;
	}

	private void setStartYear(int startYear) {
		this.startYear = startYear;
	}

	private void setEndYear(int endYear) {
		this.endYear = endYear;
	}

	private void setStratifyByRegion(RegionColumn stratifyByRegion) {
		this.stratifyByRegion = stratifyByRegion;
	}

}
