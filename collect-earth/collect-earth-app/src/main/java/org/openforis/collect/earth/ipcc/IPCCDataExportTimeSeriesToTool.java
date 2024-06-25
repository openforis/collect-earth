package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import javax.xml.bind.JAXBContext;
import javax.xml.bind.Marshaller;

import org.apache.commons.math3.util.Precision;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.AgeClassCroplandEnum;
import org.openforis.collect.earth.ipcc.model.ClimateDomainEnum;
import org.openforis.collect.earth.ipcc.model.ClimateStratumObject;
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandTypeEnum;
import org.openforis.collect.earth.ipcc.model.EcozoneStratumObject;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.GrowingStockLevelEnum;
import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.LandUseManagementEnum;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivisionStratified;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;
import org.openforis.collect.earth.ipcc.model.NutrientTypeEnum;
import org.openforis.collect.earth.ipcc.model.SettlementTypeEnum;
import org.openforis.collect.earth.ipcc.model.SoilStatusEnum;
import org.openforis.collect.earth.ipcc.model.SoilStratumObject;
import org.openforis.collect.earth.ipcc.model.SoilTypeEnum;
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
import org.openforis.collect.earth.ipcc.serialize.IPCC2006ExportSigned;
import org.openforis.collect.earth.ipcc.serialize.IpccSubdivisions;
import org.openforis.collect.earth.ipcc.serialize.LandRepresentation;
import org.openforis.collect.earth.ipcc.serialize.LandTypes;
import org.openforis.collect.earth.ipcc.serialize.LrtCountry;
import org.openforis.collect.earth.ipcc.serialize.LrtLandCategory;
import org.openforis.collect.earth.ipcc.serialize.LrtLandSubcategory;
import org.openforis.collect.earth.ipcc.serialize.LrtLandSubdivision;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnit;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnit.AreasA1D;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnitArea;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnitHistory;
import org.openforis.collect.earth.ipcc.serialize.LrtLandUnits;
import org.openforis.collect.earth.ipcc.serialize.LrtRegion;
import org.openforis.collect.earth.ipcc.serialize.LrtRegions;
import org.openforis.collect.earth.ipcc.serialize.Otherland;
import org.openforis.collect.earth.ipcc.serialize.Record;
import org.openforis.collect.earth.ipcc.serialize.Settlement;
import org.openforis.collect.earth.ipcc.serialize.SocRefTable;
import org.openforis.collect.earth.ipcc.serialize.SoilType;
import org.openforis.collect.earth.ipcc.serialize.SoilTypes;
import org.openforis.collect.earth.ipcc.serialize.Tiers;
import org.openforis.collect.earth.ipcc.serialize.Wetland;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.ArgumentPreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class IPCCDataExportTimeSeriesToTool extends AbstractIPCCDataExport {

	private static final int AREA_PRECISION = 2;

	private static final String AREAS_SUM = "AREAS_SUM";

	private static final int DEFAULT_IPCC_TRANSITION_PERIOD = 20;

	protected static final Integer LAND_REPRESENTATION_APPROACH_USED = 2;

	private static final String XSL_VERSION = "2.861";

	private static final String SUM_EXPANSION_FACTOR = "SUM_EXPANSION_FACTOR";

	private static final String SUBDIVISION_AUX = "SUBDIV_AUX";
	
	private static final String NO_SUBDIVISION = "-1";
	
	private static final String UNKNOWN_REGION = "Unknown";

	@Autowired
	private IPCCLandUses ipccLandUses;

	private String countryCode;

	private List<LandUseSubdivisionStratified<?>> subdivisionsStrata;

	private int startYear;

	private int endYear;

	private String stratifyByRegion;

	private int inventoryYear;

	private void addSoilTypes(LandTypes landTypes) {
		SoilTypes soilTypes = new SoilTypes();
		/*
		 * DO NOT ADD SOIL TYPES 
		 * We use the standard soil types from the GHGi tool
		 * te Enum already has the correct values in the DB
		 * */
		for (SoilStratumObject soil : getStrataSoil()) {
			SoilType soilType = new SoilType();
			soilType.setGuid(soil.getGuid());
			soilType.setId( soil.getSoilType().getId());
			soilType.setCompositionId( soil.getSoilType().getSoilCompositionId());
			soilType.setFullName(soil.getLabel());
			soilType.setRemark(soil.getDescription());
			soilTypes.getSoilType().add(soilType);
		}
		
		landTypes.setSoilTypes(soilTypes);
	}
	
	private void addClimateRegions(LandTypes landTypes) {
		ClimateRegions climateRegions = new ClimateRegions();
		for (ClimateStratumObject climate : getStrataClimate()) {
			ClimateRegion climateRegion = new ClimateRegion();
			climateRegion.setGuid(climate.getGuid());
			climateRegion.setId(climate.getClimateType().getId());
			climateRegion.setRemark(climate.getLabel());
			climateRegion.setDomainId( climate.getClimateType().getClimateDomain().getDomainId() );
			climateRegion.setRegion( climate.getClimateType().getClimateDomain().getDomainName() );
			climateRegions.getClimateRegion().add(climateRegion);
		}
		landTypes.setClimateRegions(climateRegions);
	}

	private void addForestland(LandTypes landTypes) {
		ForestLand forestLand = new ForestLand();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategoryEnum.F);
		
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltForestLand cltForestLand = new CltForestLand();
			cltForestLand.setId(landUseSubdivisionStratified.getId());
			
			cltForestLand.setGuid(landUseSubdivisionStratified.getGuid());
			cltForestLand.setCountryCode(getCountryCode());
			cltForestLand.setCustomName(
					landUseSubdivisionStratified.getLandUseSubdivision().getCode() 
					+ "_" + landUseSubdivisionStratified.getClimate().getLabel() 
					+ "_" + landUseSubdivisionStratified.getSoil().getLabel()
					+ "_" + landUseSubdivisionStratified.getEcozone().getLabel()
			);
			cltForestLand.setManaged(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType().equals(ManagementTypeEnum.MANAGED));
			cltForestLand.setClimateRegionId(landUseSubdivisionStratified.getClimate().getClimateType().getId());
			cltForestLand.setSoilTypeId(landUseSubdivisionStratified.getSoil().getSoilType().getId());
			cltForestLand.setSoilStatusId( SoilStatusEnum.NATURAL.getId() ); // DEFAULT TO NATURAL SOIL STATUS
			cltForestLand.setGeoPlacementId( -1 );
			// Relevant only in case of Organic soils. Should be -1 otherwise
			if( landUseSubdivisionStratified.getSoil().getSoilType().equals( SoilTypeEnum.ORG ) ) {
				cltForestLand.setNutrientTypeId( NutrientTypeEnum.UNSPECIFIED.getId() ); 
			}else {
				cltForestLand.setNutrientTypeId( NutrientTypeEnum.NOT_RELEVANT.getId() );			
			}
			cltForestLand.setEcoZoneId( landUseSubdivisionStratified.getEcozone().getEcozoneType().getId() ); // Using the "Continental" type ID from cl_continent_type in the ipcc2006.accdb
			cltForestLand.setPlantation( false );

			cltForestLand.setForestTypeId(( ( ForestSubdivision) landUseSubdivisionStratified.getLandUseSubdivision() ).getForestType().getId() );
			cltForestLand.setContinentTypeId( 1 ); // Using the "Continental" type ID from cl_continent_type in the ipcc2006.accdb
			cltForestLand.setAgeClassId( 3 ); // Using the "Unspecified" type ID from cl_age_classes in the ipcc2006.accdb

			// Set growning stock levels to < 20 years
			ClimateDomainEnum climateDomain = landUseSubdivisionStratified.getClimate().getClimateType().getClimateDomain();
			if( climateDomain.equals( ClimateDomainEnum.BOREAL ) ){
				cltForestLand.setGrowingStockLevelId( GrowingStockLevelEnum.BOREAL_21_50.getId() );				
			}else if( climateDomain.equals( ClimateDomainEnum.TEMPERATE) ){
				cltForestLand.setGrowingStockLevelId( GrowingStockLevelEnum.TEMPERATE_21_40.getId() );				
			}else if( climateDomain.equals( ClimateDomainEnum.TROPICAL) ){
				cltForestLand.setGrowingStockLevelId( GrowingStockLevelEnum.TROPICAL_21_40.getId() );				
			}else if( climateDomain.equals( ClimateDomainEnum.MEDITERRANEAN) ){
				cltForestLand.setGrowingStockLevelId( GrowingStockLevelEnum.MEDITERRANEAN__21_40.getId() );				
			}
			
			cltForestLand.setCarbonFraction(0);
			cltForestLand.setRatio(0);
			
			cltForestLand.setBcefRType(0);
			cltForestLand.setBcefR(0);
			
			cltForestLand.setAboveGroundBiomass(0);
			cltForestLand.setAboveGroundBiomassGrowth(0);
			
			cltForestLand.setMfLandUse(0);
			cltForestLand.setMfTillage(0);
			cltForestLand.setMfInput(0);
			cltForestLand.setAbandoned(false);
			
			cltForestLand.setBcefIType(0);
			cltForestLand.setBcefI(0d);
			
			cltForestLand.setBcefSType(0);
			cltForestLand.setBcefS(0d);
			
			forestLand.getCltForestLand().add(cltForestLand);
		}
		landTypes.setForestLand(forestLand);
	}

	private void addCropland(LandTypes landTypes) {
		Cropland cropLand = new Cropland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategoryEnum.C);

		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltCropland cltCropLand = new CltCropland();
			cltCropLand.setId(landUseSubdivisionStratified.getId());
			cltCropLand.setGuid(landUseSubdivisionStratified.getGuid());
			cltCropLand.setCountryCode(getCountryCode());
			cltCropLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getCode() + "_" + landUseSubdivisionStratified.getClimate().getLabel() + "_" + landUseSubdivisionStratified.getSoil().getLabel());
			cltCropLand.setClimateRegionId(landUseSubdivisionStratified.getClimate().getClimateType().getId());
			cltCropLand.setSoilTypeId(landUseSubdivisionStratified.getSoil().getSoilType().getId());
			cltCropLand.setSoilStatusId( SoilStatusEnum.NATURAL.getId() ); // DEFAULT TO NATURAL SOIL STATUS
			cltCropLand.setGeoPlacementId( -1 );

			// Relevant only in case of Organic soils. Should be -1 otherwise
			if( landUseSubdivisionStratified.getSoil().getSoilType().equals( SoilTypeEnum.ORG ) ) {
				cltCropLand.setNutrientTypeId( NutrientTypeEnum.UNSPECIFIED.getId() ); 
			}else {
				cltCropLand.setNutrientTypeId( NutrientTypeEnum.NOT_RELEVANT.getId() );			
			}
			
			cltCropLand.setPerennialCrops(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType().equals(CroplandTypeEnum.PERENNIAL));
			
			cltCropLand.setCroplandTypeId( ( (CroplandSubdivision) landUseSubdivisionStratified.getLandUseSubdivision() ).getPerennialCropType().getId() );
			
			cltCropLand.setBWoodyUnitId( 0 );
			cltCropLand.setBHerbUnitId(0);
			cltCropLand.setAgeClassId( AgeClassCroplandEnum.UNSPECIFIED.getId());
			
			cropLand.getCltCropland().add(cltCropLand);
		}
		landTypes.setCropland(cropLand);
	}


	private void addGrassland(LandTypes landTypes) {
		Grassland grassLand = new Grassland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategoryEnum.G);

		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltGrassland cltGrassLand = new CltGrassland();
			cltGrassLand.setId(landUseSubdivisionStratified.getId());
			cltGrassLand.setGuid(landUseSubdivisionStratified.getGuid());
			cltGrassLand.setCountryCode(getCountryCode());
			cltGrassLand.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getCode() + "_" + landUseSubdivisionStratified.getClimate().getLabel() + "_" + landUseSubdivisionStratified.getSoil().getLabel());
			cltGrassLand.setManaged(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType().equals(ManagementTypeEnum.MANAGED));
			cltGrassLand.setClimateRegionId(landUseSubdivisionStratified.getClimate().getClimateType().getId());
			cltGrassLand.setSoilTypeId(landUseSubdivisionStratified.getSoil().getSoilType().getId());
			cltGrassLand.setSoilStatusId( SoilStatusEnum.NATURAL.getId() ); // DEFAULT TO NATURAL SOIL STATUS
			cltGrassLand.setGeoPlacementId(-1);
			// Relevant only in case of Organic soils. Should be -1 otherwise
			if( landUseSubdivisionStratified.getSoil().getSoilType().equals( SoilTypeEnum.ORG ) ) {
				cltGrassLand.setNutrientTypeId( NutrientTypeEnum.UNSPECIFIED.getId() ); 
			}else {
				cltGrassLand.setNutrientTypeId( NutrientTypeEnum.NOT_RELEVANT.getId() );			
			}
			
			cltGrassLand.setImprovedGrassland(false);
			cltGrassLand.setVegetationTypeId( ( (GrasslandSubdivision) landUseSubdivisionStratified.getLandUseSubdivision() ).getVegetationType().getId() );
			cltGrassLand.setRatioBgbAgbHerb( ( (GrasslandSubdivision) landUseSubdivisionStratified.getLandUseSubdivision() ).getVegetationType().getRatioBgb() );
			
			cltGrassLand.setAgeClassId( AgeClassCroplandEnum.UNSPECIFIED.getId() );
			
			grassLand.getCltGrassland().add(cltGrassLand);
		}
		landTypes.setGrassland(grassLand);
	}

	private void addWetland(LandTypes landTypes) {
		Wetland wetland = new Wetland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategoryEnum.W);
		
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltWetland cltWetland = new CltWetland();
			cltWetland.setId(landUseSubdivisionStratified.getId());
			cltWetland.setGuid(landUseSubdivisionStratified.getGuid());
			cltWetland.setCountryCode(getCountryCode());
			cltWetland.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getCode() + "_" + landUseSubdivisionStratified.getClimate().getLabel() + "_" + landUseSubdivisionStratified.getSoil().getLabel());
			cltWetland.setManaged(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType().equals(ManagementTypeEnum.MANAGED));
			cltWetland.setClimateRegionId(landUseSubdivisionStratified.getClimate().getClimateType().getId());
			cltWetland.setSoilTypeId(landUseSubdivisionStratified.getSoil().getSoilType().getId());
			cltWetland.setSoilStatusId( SoilStatusEnum.NATURAL.getId() ); // DEFAULT TO NATURAL SOIL STATUS
			// Relevant only in case of Organic soils. Should be -1 otherwise
			if( landUseSubdivisionStratified.getSoil().getSoilType().equals( SoilTypeEnum.ORG ) ) {
				cltWetland.setNutrientTypeId( NutrientTypeEnum.UNSPECIFIED.getId() ); 
			}else {
				cltWetland.setNutrientTypeId( NutrientTypeEnum.NOT_RELEVANT.getId() );			
			}
			
			// 2 char value: PE = Peatland extraction; PA = Peatland abandoned, FL = Flooded land, OW = Other wetland
			cltWetland.setWetlandType( "OW"); 
			
			cltWetland.setGeoPlacementId(-1);
			
			cltWetland.setAgeClassId( AgeClassCroplandEnum.UNSPECIFIED.getId() );
						
			wetland.getCltWetland().add(cltWetland);
		}
		landTypes.setWetland(wetland);
	}
	
	private void addSettlement(LandTypes landTypes) {
		Settlement settlement = new Settlement();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategoryEnum.S);
		
		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltSettlement cltSettlement = new CltSettlement();
			cltSettlement.setId(landUseSubdivisionStratified.getId());
			cltSettlement.setGuid(landUseSubdivisionStratified.getGuid());
			cltSettlement.setCountryCode(getCountryCode());
			cltSettlement.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getCode() + "_" + landUseSubdivisionStratified.getClimate().getLabel() + "_" + landUseSubdivisionStratified.getSoil().getLabel());
			cltSettlement.setClimateRegionId(landUseSubdivisionStratified.getClimate().getClimateType().getId());
			cltSettlement.setSoilTypeId(landUseSubdivisionStratified.getSoil().getSoilType().getId());
			cltSettlement.setSoilStatusId( SoilStatusEnum.NATURAL.getId() ); // DEFAULT TO NATURAL SOIL STATUS
			cltSettlement.setGeoPlacementId(-1);
			// Relevant only in case of Organic soils. Should be -1 otherwise
			if( landUseSubdivisionStratified.getSoil().getSoilType().equals( SoilTypeEnum.ORG ) ) {
				cltSettlement.setNutrientTypeId( NutrientTypeEnum.UNSPECIFIED.getId() ); 
			}else {
				cltSettlement.setNutrientTypeId( NutrientTypeEnum.NOT_RELEVANT.getId() );			
			}
			
			cltSettlement.setSettlementTypeId( ( (SettlementTypeEnum ) landUseSubdivisionStratified.getLandUseSubdivision().getManagementType() ).getId() );			
			cltSettlement.setAgeClassId( AgeClassCroplandEnum.UNSPECIFIED.getId() );
			cltSettlement.setNumberOfClasses(1);
			
			settlement.getCltSettlement().add(cltSettlement);
		}
		landTypes.setSettlement(settlement);
	}

	private void addOtherland(LandTypes landTypes) {
		Otherland otherland = new Otherland();
		List<LandUseSubdivisionStratified<?>> climateSoilLandUseCombination = getClimateSoilLandUseCombination(
				LandUseCategoryEnum.O);

		for (LandUseSubdivisionStratified landUseSubdivisionStratified : climateSoilLandUseCombination) {
			CltOtherland cltOtherland = new CltOtherland();
			cltOtherland.setId(landUseSubdivisionStratified.getId());
			cltOtherland.setGuid(landUseSubdivisionStratified.getGuid());
			cltOtherland.setCountryCode(getCountryCode());
			cltOtherland.setCustomName(landUseSubdivisionStratified.getLandUseSubdivision().getCode() + "_" + landUseSubdivisionStratified.getClimate().getLabel() + "_" + landUseSubdivisionStratified.getSoil().getLabel());
			cltOtherland.setManaged(landUseSubdivisionStratified.getLandUseSubdivision().getManagementType().equals(ManagementTypeEnum.MANAGED));
			cltOtherland.setClimateRegionId(landUseSubdivisionStratified.getClimate().getClimateType().getId());
			cltOtherland.setSoilTypeId(landUseSubdivisionStratified.getSoil().getSoilType().getId());
			cltOtherland.setGeoPlacementId(-1);
			// Relevant only in case of Organic soils. Should be -1 otherwise
			if( landUseSubdivisionStratified.getSoil().getSoilType().equals( SoilTypeEnum.ORG ) ) {
				cltOtherland.setNutrientTypeId( NutrientTypeEnum.UNSPECIFIED.getId() ); 
			}else {
				cltOtherland.setNutrientTypeId( NutrientTypeEnum.NOT_RELEVANT.getId() );			
			}
			otherland.getCltOtherland().add(cltOtherland);
		}
		landTypes.setOtherland(otherland);
	}

	public File generateTimeseriesData(int inventoryYear, int startYear, int endYear, String countryCode,
			String stratifyByRegion) throws IOException, IPCCGeneratorException {
		
		this.setInventoryYear(inventoryYear);
		this.setStartYear(startYear);
		this.setEndYear(endYear);
		this.setCountryCode(countryCode);
		this.setStratifyByRegion(stratifyByRegion);
		setSubdivisionsStrata( new ArrayList<>() );
		initSchemaName();

		File zipFileWithInventoryData = new File("ghgi_timeseries_ipcc_tool.xml");
		zipFileWithInventoryData.deleteOnExit();

		IPCC2006Export ipcc2006Export = new IPCC2006Export();
		ipcc2006Export.setCountryCode(getCountryCode());
		ipcc2006Export.setVersion(XSL_VERSION);
		ipcc2006Export.setInventoryYear(inventoryYear);
		Tiers tiers = new Tiers();
		ipcc2006Export.setTiers( tiers);
		
		ipcc2006Export.setIpccSubdivisions( new IpccSubdivisions() );

		Record record = new Record();

		LandTypes landType = new LandTypes();
		landType.setCountryCode( countryCode );
		SocRefTable socRefTable = new SocRefTable();
		socRefTable.setCountryCode(countryCode);
		landType.setSocRefTable( socRefTable );
		
		addClimateAndSoil(landType);
		addLandClasses(landType);

		LandRepresentation landRepresentation = new LandRepresentation();
		LrtCountry lrtCountry = new LrtCountry();
		lrtCountry.setCountryCode(getCountryCode());
		lrtCountry.setArea(getTotalArea());
		lrtCountry.setRegions(getLrtRegions());

		landRepresentation.setLrtCountry(lrtCountry);

		landType.setLandRepresentation(landRepresentation);

		record.setLandTypes(landType);

		ipcc2006Export.getRecord().add(record);

		File ipccInventroyYearTemp = generateXMLFile(ipcc2006Export);

		return ipccInventroyYearTemp;
	}

	private LrtRegions getLrtRegions() {
		LrtRegions regions = new LrtRegions();

		// Collect the regions in the country
		String selectDiferentRegions = "select " + getStratifyByRegion() + ", SUM(" + RegionCalculationUtils.EXPANSION_FACTOR + ") AS " + SUM_EXPANSION_FACTOR 
		+ " from " + getSchemaName() + PLOT_TABLE 
		+ " GROUP BY "	+ getStratifyByRegion();
				
		Collection<LrtRegion> regionList = getJdbcTemplate().query(

				selectDiferentRegions,

				new RowMapper<LrtRegion>() {
					@Override
					public LrtRegion mapRow(ResultSet rs, int rowNum) throws SQLException {

						String regionName = rs.getString( getStratifyByRegion() );
						
						if( regionName == null || regionName.trim().isEmpty() ) {
                            regionName = UNKNOWN_REGION;
                        }
						regionName = regionName.replaceAll("'", ""); // remove single quotes that can cause errors when importing to IPCC
						Double area = Precision.round( rs.getDouble( SUM_EXPANSION_FACTOR ), AREA_PRECISION ) ;

						LrtRegion lrtRegion = new LrtRegion();
						lrtRegion.setArea(area);
						lrtRegion.setGuid( UUID.randomUUID().toString()  );
						lrtRegion.setName(regionName);
						lrtRegion.setApproachId( LAND_REPRESENTATION_APPROACH_USED ); // defaults to IPCC Approach 2

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
		lrtRegion.getLandCategories(); //initialize
		for (LandUseCategoryEnum landUseCat : LandUseCategoryEnum.values()) {
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
			LandUseCategoryEnum landUseCat) {

		Collection<LrtLandSubcategory> lartLandUseSubcategory = new ArrayList<LrtLandSubcategory>();
		for (LandUseManagementEnum landUseManagement : LandUseManagementEnum.find(landUseCat)) {

			LrtLandSubcategory lrtSubcategory = new LrtLandSubcategory();

			lrtSubcategory.setScatId(landUseManagement.getId());
			Collection<? extends LrtLandSubdivision> lrtLandSubdivisions = getLrtLandSubdivisions(lrtRegion,landUseManagement);
			if (lrtLandSubdivisions.size() > 0) {
				lrtSubcategory.getLandSubdivisions().getLrtLandSubdivision().addAll(lrtLandSubdivisions);
				lartLandUseSubcategory.add(lrtSubcategory);
			}

		}
		return lartLandUseSubcategory;
	}

	private Collection<? extends LrtLandSubdivision> getLrtLandSubdivisions(LrtRegion lrtRegion,
			LandUseManagementEnum landUseManagement) {

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

	protected RowMapper<LrtLandUnit> getLandUnitsRowMapper(LandUseSubdivisionStratified<?> landUseSubdivisionStratified) {
		return new RowMapper<LrtLandUnit>() {
			@Override
			public LrtLandUnit mapRow(ResultSet rs, int rowNum) throws SQLException {

				
				String subcategory = rs.getString(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBCATEGORY);
				Integer subcategoryYearChange = rs.getInt(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED);
				String subdivision = rs.getString(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION);
				Integer subdivisionYearChange = rs.getInt(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED);
				String initialSubdivision = rs.getString(IPCCSurveyAdapter.TEMPLATE_LAND_USE_INITIAL_SUBDIVISION);
				Integer subdivisionChangeYear = rs.getInt(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED);
				String secondLUConversion = rs.getString(IPCCSurveyAdapter.TEMPLATE_SECOND_LU_CONVERSION);
				Integer secondLUConversionYear = rs.getInt(IPCCSurveyAdapter.TEMPLATE_SECOND_LU_CONVERSION_YEAR);
				String secondLUSubdivision = rs.getString(IPCCSurveyAdapter.TEMPLATE_LAND_USE_SECOND_SUBDIVISION);

				String luCurrentCategory = subcategory.substring(1, 2); // The conversion would be FC (current land use would be C)
				String luPreviousCategory = subcategory.substring(0, 1); // The conversion would be FC (initial land use would be F)
				
				LrtLandUnit landUnit = new LrtLandUnit();

				String unitCode = subcategory +"-"+subcategoryYearChange+"-"+subdivision+"-"+subdivisionYearChange+"-";
				unitCode += initialSubdivision +"-"+subdivisionChangeYear+"-";
				//unitCode += secondLUConversion +"-"+secondLUConversionYear+"-"+subdivision+"-"+secondLUSubdivision;
				//unitCode += landUseSubdivisionStratified.getSoil().getValue() +"-"+landUseSubdivisionStratified.getClimate().getValue();
				
				landUnit.setGuid( UUID.randomUUID().toString() );
				landUnit.setUnitCode( unitCode  );
				landUnit.setTransPeriod( DEFAULT_IPCC_TRANSITION_PERIOD );
				landUnit.setIsMerged(false); // DEFAULT FALSE
				landUnit.setPmBiomass( 2 ); // DEFAULT 2
				landUnit.setPmDomDeadwood( 2 ); // DEFAULT 2
				landUnit.setPmDomLitter( 2 ); // DEFAULT 2
				landUnit.setPmSomMineral(1); // DEFAULT 1

				LrtLandUnitHistory landUnitHistory = new LrtLandUnitHistory();

				if (luCurrentCategory.equals(luPreviousCategory)) { // No change of category
					if (subdivisionYearChange != null && subdivisionYearChange > -1) { // But there is a change of subdivision within the same category
						
						landUnit.setConvYear(subdivisionYearChange);
						LandUseCategoryEnum luInitial = LandUseCategoryEnum.valueOf(luPreviousCategory);
						
						// Set the initial Land Use subdivision
						AbstractLandUseSubdivision<?> previous = LandUseSubdivisionUtils.getSubdivision(luInitial.getCode(), initialSubdivision);
						if( previous == null || LandUseManagementEnum.find(luInitial, previous.getManagementType()) == null ) {
							logger.warn( "Error getting the LU subdivison ", luInitial.toString() + "  -  " + secondLUSubdivision );
						}
						landUnit.setLtIdPrev(LandUseManagementEnum.find(luInitial, previous.getManagementType()).getId());
						
						landUnit.setCltIdPrev(
							findStrataLandRepresentation( luInitial, initialSubdivision, landUseSubdivisionStratified.getClimate(), landUseSubdivisionStratified.getSoil(), landUseSubdivisionStratified.getEcozone() ).getId()
						);
					} else {
						landUnit.setConvYear(-2);
						landUnit.setLtIdPrev(-200);
						landUnit.setCltIdPrev(-200);
					}
				} else {
					landUnit.setConvYear(subcategoryYearChange);
					
					LandUseCategoryEnum luInitial = LandUseCategoryEnum.valueOf(luPreviousCategory);
					// Set the initial Land Use subdivision
					AbstractLandUseSubdivision<?> previous = LandUseSubdivisionUtils.getSubdivision(luInitial.getCode(), initialSubdivision);

					landUnit.setLtIdPrev(luInitial.getId());
					
					landUnit.setCltIdPrev(
							findStrataLandRepresentation(luInitial, initialSubdivision, landUseSubdivisionStratified.getClimate(), landUseSubdivisionStratified.getSoil(), landUseSubdivisionStratified.getEcozone()).getId()
						);
/*
					if (secondLUConversion != null && !secondLUConversion.equals("-1")) {

						LandUseCategoryEnum luInitial = LandUseCategoryEnum.valueOf(luPreviousCategory);
						AbstractLandUseSubdivision<?> subdivisionInitial = LandUseSubdivisionUtils
								.getSubdivision(luInitial.getCode(), secondLUSubdivision);

						LrtLandUnitHistoryRecord lrtLandUnitHistoryRecord = new LrtLandUnitHistoryRecord();
						lrtLandUnitHistoryRecord.setLtIdPrev(luInitial.getId());
						lrtLandUnitHistoryRecord.setCltIdPrev(subdivisionInitial.getId());
						lrtLandUnitHistoryRecord.setTransPeriod( DEFAULT_IPCC_TRANSITION_PERIOD );
						lrtLandUnitHistoryRecord.setConvYear(secondLUConversionYear);

						landUnitHistory.getLrtLandUnitHistoryRecord().add(lrtLandUnitHistoryRecord);
					}
*/
				}

				landUnit.setHistory(landUnitHistory);
				landUnit.setAreasA1D( new AreasA1D() );
				LrtLandUnit.Areas areas = new LrtLandUnit.Areas();

				for( int year=getStartYear(); year<= getEndYear(); year++ ) {
					LrtLandUnitArea lrtLandUnitArea = new LrtLandUnitArea();
					lrtLandUnitArea.setValue( Precision.round( rs.getDouble(AREAS_SUM), AREA_PRECISION ) );
					lrtLandUnitArea.setYear( year );
					if( getInventoryYear() == year ) {
						lrtLandUnitArea.setIsSource( true );
					}
					areas.getArea().add(lrtLandUnitArea);
				}

				landUnit.setAreas(areas);
				return landUnit;
			}

			private boolean isEqual(
					LandUseSubdivisionStratified subdivStrata,
					LandUseCategoryEnum landUseCategory,
					String landUseSubdivision, 
					ClimateStratumObject climate, 
					SoilStratumObject soil,
					EcozoneStratumObject ecozone
				) {
				boolean result =  
					subdivStrata.getLandUseCategory().equals(landUseCategory) && 
					subdivStrata.getLandUseSubdivision().getCode().equals( landUseSubdivision) &&
					subdivStrata.getClimate().getValue().equals(climate.getValue() )  && 
					subdivStrata.getSoil().getValue().equals(soil.getValue() ) 
					&&	(
							subdivStrata.getEcozone() ==null 
							|| 
							ecozone ==null  // ecozone should not be Null for Forest classes
							||
							subdivStrata.getEcozone().getValue().equals(ecozone.getValue() ) 
							 
						);
				return result;
			}
			
			private LandUseSubdivisionStratified<?> findStrataLandRepresentation(
					LandUseCategoryEnum landUseCategory,
					String landUseSubdivision, 
					ClimateStratumObject climate, 
					SoilStratumObject soil,
					EcozoneStratumObject ecozone
				) {
				return getSubdivisionsStrata().stream()
					.filter( subdivStrata -> isEqual(subdivStrata, landUseCategory, landUseSubdivision, climate, soil, ecozone) ).findFirst()
					.orElseThrow(() -> new IllegalArgumentException("No LU Subdivisions found for " + landUseCategory + "  - " + landUseSubdivision + " - " + climate + " - " + soil + " - " + ecozone)
				);
			}
		};
	}
	
	private List<LrtLandUnit> generateLandUnits(LrtRegion lrtRegion, LandUseSubdivisionStratified<?> landUseSubdivisionStratified) {

		// Generate Land Units no change FF/CC/SS/OO/WW/GG throughout the whole period
		
		// For each year generate the pre and post land unit
		
		
		String sqlGrouping = IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBCATEGORY + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBCATEGORY_YEAR_CHANGED + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_INITIAL_SUBDIVISION + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_SUBDIVISION_YEAR_CHANGED + ", "
				+ IPCCSurveyAdapter.TEMPLATE_LAND_USE_SECOND_SUBDIVISION + ", "
				+ IPCCSurveyAdapter.TEMPLATE_SECOND_LU_CONVERSION + ", "
				+ IPCCSurveyAdapter.TEMPLATE_SECOND_LU_CONVERSION_YEAR 
				;
		
		String sqlSelectPreparedStatement = 
				"select " + sqlGrouping + ", sum( " + RegionCalculationUtils.EXPANSION_FACTOR + ") AS " + AREAS_SUM 
					+ " FROM " + PLOT_TABLE 
					+ " where " 
					+ SOIL + " = ? and " 
					+ CLIMATE + " = ? and "
					+ ( landUseSubdivisionStratified.getEcozone() !=null? GEZ + "= " +  landUseSubdivisionStratified.getEcozone().getValue() + " and " : "" )
					+ IPCCSurveyAdapter.ATTR_CURRENT_CATEGORY + " = ? and "
					+ IPCCSurveyAdapter.ATTR_CURRENT_SUBDIVISION + " = ? and "
					+ getStratifyByRegion() + " = ? "

					+ " GROUP BY " + sqlGrouping + " ORDER BY " + AREAS_SUM
					+ " DESC";

		
		
		List<LrtLandUnit> luData = getJdbcTemplate().query(
				sqlSelectPreparedStatement, 
				new ArgumentPreparedStatementSetter( new Object[] {
						landUseSubdivisionStratified.getSoil().getValue(),
						landUseSubdivisionStratified.getClimate().getValue(),
						landUseSubdivisionStratified.getLandUseCategory().getCode(), 
						landUseSubdivisionStratified.getLandUseSubdivision().getCode(),
						lrtRegion.getName()
					} ),			
				getLandUnitsRowMapper(landUseSubdivisionStratified)
				
			);
		
		return luData;
	}

	private Double getTotalArea() {
		return getJdbcTemplate().queryForObject(
				"select SUM(" + RegionCalculationUtils.EXPANSION_FACTOR + ") from " + getSchemaName() + PLOT_TABLE, 
				Double.class
		);
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

	protected File generateXMLFile(IPCC2006Export ipcc2006Export) throws IOException, IPCCGeneratorException {
		File xmlFileDestination = new File("ImportIntoGHGiTool.xml");
		File xmlFileDestinationSigned = new File("ImportIntoGHGiTool_with_MD5.xml");
		xmlFileDestination.deleteOnExit();
		xmlFileDestinationSigned.deleteOnExit();

		marshallXMLToFile(ipcc2006Export, xmlFileDestination, IPCC2006Export.class);
		/*
		try {
			// Add a signature to the ipcc2006Export so it can be ingested by the IPCC tool
			/* Until the MD5 generation is fixed we use CollectEarth as signature
			byte[] data = Files.readAllBytes(Paths.get(xmlFileDestination.toURI()));
			byte[]hash = MessageDigest.getInstance("MD5").digest(data);
			String checksum = Base64.getMimeEncoder().encodeToString(hash);
			*/
			IPCC2006ExportSigned signedIpcc2006Export = IPCC2006ExportSigned.cloneAndSign(ipcc2006Export, "CollectEarth");
			marshallXMLToFile(signedIpcc2006Export, xmlFileDestinationSigned, IPCC2006ExportSigned.class);
/*
		} catch (NoSuchAlgorithmException e) {
			throw new IPCCGeneratorException("Could not sign the GHGi Tool packages");
		}
*/
		return xmlFileDestinationSigned;
	}

	private void marshallXMLToFile(IPCC2006Export ipcc2006Export, File xmlFileDestination, Class classToMarshall)
			throws IOException, FileNotFoundException {
		JAXBContext jc;
		try {
			//jc = JAXBContext.newInstance(ObjectFactory.class.getPackage().getName(), ObjectFactory.class.getClassLoader());
			jc = JAXBContext.newInstance(classToMarshall, classToMarshall);
			Marshaller m = jc.createMarshaller();
			m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.TRUE);
			try (OutputStream os = new FileOutputStream(xmlFileDestination)) {
				m.marshal(ipcc2006Export, os);
				os.close();
			}

		} catch (Exception e1) {
			logger.error("Error marshalling data to " + xmlFileDestination.getAbsolutePath(), e1);
		}
	}

	private List<LandUseSubdivisionStratified<?>> getClimateSoilLandUseCombination(LandUseCategoryEnum luCategory) {
			ArrayList<LandUseSubdivisionStratified<?>> subdivisions = new ArrayList<LandUseSubdivisionStratified<?>>();
			String selectDistincts = null;
			// For Forest we stratify by Soil, Climate and Ecozone
			// The rest of categories only use Soil and Climate
			if( luCategory.equals( LandUseCategoryEnum.F ) ) {
				selectDistincts = "select " 
						+ "DISTINCT " + IPCCSurveyAdapter.ATTR_CURRENT_SUBDIVISION + " AS " + SUBDIVISION_AUX +", " + CLIMATE_COLUMN + ", " + SOIL_COLUMN + ", "+ GEZ_COLUMN
						+ " from " + getSchemaName() + PLOT_TABLE 
						+ " where " + IPCCSurveyAdapter.ATTR_CURRENT_CATEGORY + " = ? "
						+ " AND " + SUBDIVISION_AUX + "!= ?";
			}else {
				selectDistincts = "select " 
						+ "DISTINCT " 
						+ IPCCSurveyAdapter.ATTR_CURRENT_SUBDIVISION + " AS " + SUBDIVISION_AUX +", " + CLIMATE_COLUMN + ", "	+ SOIL_COLUMN 
						+ " from " + getSchemaName() + PLOT_TABLE 
						+ " where " + IPCCSurveyAdapter.ATTR_CURRENT_CATEGORY + " = ? "
						+ " AND " + SUBDIVISION_AUX + "!= ?";
			}
			
			List<LandUseSubdivisionStratified<?>> substratasInLastYear = getJdbcTemplate().query(
					selectDistincts, 
					new ArgumentPreparedStatementSetter( new Object[] {luCategory.getCode(), NO_SUBDIVISION} ),			
					getLUSubdivisionStratifiedRowMapper(luCategory, 0)
				);

			// Put these values into a variable so that we can use the same IDs later!
			subdivisions.addAll(substratasInLastYear);
			
			
			/// NOW WE GET THE PREVIOS SUBDIVISIONSSS PROBLEM IF THE FIRST YEAR HAS SUBDIVIISONS NOT PRESENT IN THE LAST
			// For Forest we stratify by Soil, Climate and Ecozone
			// The rest of categories only use Soil and Climate
			if( luCategory.equals( LandUseCategoryEnum.F ) ) {
				selectDistincts = "select " 
						+ "DISTINCT " + IPCCSurveyAdapter.TEMPLATE_LAND_USE_INITIAL_SUBDIVISION + " AS " + SUBDIVISION_AUX +", " + CLIMATE_COLUMN + ", " + SOIL_COLUMN + ", "+ GEZ_COLUMN
						+ " from " + getSchemaName() + PLOT_TABLE 
						+ " where " + IPCCSurveyAdapter.ATTR_PREVIOUS_CATEGORY + " = '" + luCategory.getCode() + "'"
						+ " AND " + SUBDIVISION_AUX + "!='-1'";
			}else {
				selectDistincts = "select " 
						+ "DISTINCT "  + IPCCSurveyAdapter.TEMPLATE_LAND_USE_INITIAL_SUBDIVISION + " AS " + SUBDIVISION_AUX +", " + CLIMATE_COLUMN + ", "	+ SOIL_COLUMN 
						+ " from " + getSchemaName() + PLOT_TABLE 
						+ " where " + IPCCSurveyAdapter.ATTR_PREVIOUS_CATEGORY + " = '" + luCategory.getCode() + "'" 
						+ " AND " + SUBDIVISION_AUX + "!='-1'";
			}
			
			List<LandUseSubdivisionStratified<?>> substratasInFirstYear = getJdbcTemplate().query(
					selectDistincts 
					,
					getLUSubdivisionStratifiedRowMapper(luCategory, subdivisions.size())
					);
	
			substratasInFirstYear.forEach( (t) -> { if( !subdivisions.contains(t) ) subdivisions.add(t); } );
			
			
			subdivisionsStrata.addAll(subdivisions);
		
			return subdivisions;
	}

	private RowMapper<LandUseSubdivisionStratified<?>> getLUSubdivisionStratifiedRowMapper(
			LandUseCategoryEnum luCategory, int idStart) {
		return new RowMapper<LandUseSubdivisionStratified<?>>() {
			@Override
			public LandUseSubdivisionStratified mapRow(ResultSet rs, int rowNum) throws SQLException {
				String landUseSubdivision = rs.getString( SUBDIVISION_AUX );
				AbstractLandUseSubdivision<?> luSubItem = getIpccLandUses().getLandUseSubdivisions().stream()
						.filter(luSubElem -> luSubElem.getCode().equals(landUseSubdivision)).findFirst()
						.orElseThrow(() -> new IllegalArgumentException(
								"No LU Subdivisions found for " + landUseSubdivision));

				Integer climateCode = rs.getInt(CLIMATE_COLUMN);
				ClimateStratumObject climateItem = getStrataClimate().stream()
						.filter(climElem -> Integer.valueOf(climElem.getValue()).equals(climateCode))
						.findFirst()
						.orElseThrow(() -> new IllegalArgumentException("No Climate found for " + climateCode));

				Integer soilCode = rs.getInt(SOIL_COLUMN);
				SoilStratumObject soilItem = getStrataSoil().stream()
						.filter(soilElem -> Integer.valueOf(soilElem.getValue()).equals(soilCode)).findFirst()
						.orElseThrow(() -> new IllegalArgumentException("No Soil found for " + soilCode));
				
				Integer seqId = luCategory.getId() *1000 + getSubdivisionsStrata().size() + rowNum + idStart;
				
				// Add Ecozone to Forest subdivisions!
				if( luCategory.equals( LandUseCategoryEnum.F ) ) {
					Integer ecozoneCode = rs.getInt( GEZ_COLUMN );
					EcozoneStratumObject ecozoneItem = getStrataEcozone().stream()
							.filter(ecozoneElem -> Integer.valueOf(ecozoneElem.getValue()).equals(ecozoneCode)).findFirst()
							.orElseThrow(() -> new IllegalArgumentException("No Ecozone found for " + ecozoneCode));
					
					return new LandUseSubdivisionStratified(luCategory, luSubItem, climateItem, soilItem, ecozoneItem, seqId);
				}else {
					return new LandUseSubdivisionStratified(luCategory, luSubItem, climateItem, soilItem, seqId);
				}

			}

		};
	}

	private String getCountryCode() {
		return countryCode;
	}

	private void setCountryCode(String countryCode) {
		this.countryCode = countryCode;
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

	private String getStratifyByRegion() {
		return stratifyByRegion;
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

	private void setStratifyByRegion(String stratifyByRegion) {
		this.stratifyByRegion = stratifyByRegion;
	}

	private int getInventoryYear() {
		return inventoryYear;
	}

	private void setInventoryYear(int inventoryYear) {
		this.inventoryYear = inventoryYear;
	}

}
