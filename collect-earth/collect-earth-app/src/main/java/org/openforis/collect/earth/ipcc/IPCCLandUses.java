package org.openforis.collect.earth.ipcc;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RDBConnector;
import org.openforis.collect.earth.app.service.SchemaService;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandTypeEnum;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestTypeEnum;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseCategoryEnum;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;
import org.openforis.collect.earth.ipcc.model.OtherlandSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementTypeEnum;
import org.openforis.collect.earth.ipcc.model.VegetationTypeEnum;
import org.openforis.collect.earth.ipcc.model.WetlandSubdivision;
import org.openforis.idm.metamodel.CodeList;
import org.openforis.idm.metamodel.CodeListLevel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class IPCCLandUses extends RDBConnector {
	
	@Autowired
	private SchemaService schemaService;
	
	@Autowired
	private EarthSurveyService earthSurveyService;

	private String LU_CATEGORY_COLUMN; // Italy--> _category || Benin --> _use
	private String LU_TABLE;
	private String LU_CATEGORY_ID;
	private String schemaName;
	private String LU_SUBDIVISION ;
	private String LU_SUBDIVISION_LABEL;
	private String LU_SUBDIVISION_TABLE;
	public String CODE_LIST_LAND_USE; // ITALY -> land_uses   --  BENIN -> land_use
	public String CODE_LIST_LAND_USE_SUBCATEGORY; // Italy --> land_use_conversions  --  Benin --> land_use_subcategory
	
	Logger logger = LoggerFactory.getLogger(IPCCLandUses.class);

	private List<AbstractLandUseSubdivision> landUseSubdivisions;

	public IPCCLandUses() {
		super();
		setExportTypeUsed(ExportType.IPCC);


	}
	
	public void initializeCodeListValues() {

		// ITALY -> land_uses   --  BENIN -> land_use
		String[] possibleTableNames = new String[] { "land_uses", "land_use" };
		for (String tableName : possibleTableNames) {
			
			if (codeListExists(tableName)) {
				this.CODE_LIST_LAND_USE = tableName;
				break;
			}
		}
		
		if (this.CODE_LIST_LAND_USE == null) {
			throw new IllegalArgumentException("No land use table found in the database");
		}

		// Italy --> land_use_conversions  --  Benin --> land_use_subcategory
		possibleTableNames = new String[] { "land_use_conversions", "land_use_subcategory" };
		for (String tableName : possibleTableNames) {
			
			if (codeListExists(tableName)) {
				this.CODE_LIST_LAND_USE_SUBCATEGORY = tableName;
				break;
			}
		}
		
		if (this.CODE_LIST_LAND_USE_SUBCATEGORY == null) {
			throw new IllegalArgumentException("No land use subcategory table found in the database");
		}
		
		// Check if the LU_TaABLE exists in the database for the possible suffixes
		// We made an error and changed the name of this attribute in the new template and it doesn't match the pre-IPCC attribute
		String[] possibleSuffixes = new String[] { "category", "use" };
		for (String suffix : possibleSuffixes) {
			if (codeListAndLevelExists(CODE_LIST_LAND_USE, suffix )) {
				LU_CATEGORY_COLUMN = CODE_LIST_LAND_USE + "_" + suffix;
				LU_TABLE = LU_CATEGORY_COLUMN + "_code";
				break;
			}
		}

		LU_CATEGORY_ID = LU_TABLE + "_id";
		
		LU_SUBDIVISION = CODE_LIST_LAND_USE + "_subdivision";
		LU_SUBDIVISION_LABEL = LU_SUBDIVISION + "_label";
		LU_SUBDIVISION_TABLE = LU_SUBDIVISION + "_code";
		
	}
	
	private boolean codeListExists(String codeListName) {
		
		try {
			return earthSurveyService.getCollectSurvey().getCodeList(codeListName) != null;
		} catch (Exception e) {
			logger.error("Error checking if code list exists " + codeListName, e);
			return false;
		}
	}

	
	private boolean codeListAndLevelExists(String codeListName, String levelName) {
		try {
			CodeList codeList = earthSurveyService.getCollectSurvey().getCodeList(codeListName);
			List<CodeListLevel> levels = codeList.getHierarchy();
			for (CodeListLevel codeListLevel : levels) {
				if (codeListLevel.getName().equalsIgnoreCase(levelName)) {
					return true;
				}
			}
			return false;
		} catch (Exception e) {
			logger.error("Error checking if code list and level exists " + codeListName + " - " + levelName, e);
			return false;
		}
	}
	
	public List<AbstractLandUseSubdivision> getLandUseSubdivisions() {

		if (landUseSubdivisions != null) {
			return landUseSubdivisions;
		}

		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());

		LandUseCategoryEnum[] lUseCategories = LandUseCategoryEnum.values();

		landUseSubdivisions = new ArrayList<AbstractLandUseSubdivision>();

		for (int i = 0; i < lUseCategories.length; i++) {

			landUseSubdivisions.addAll(getSubdivisions(lUseCategories[i]));

		}

		return landUseSubdivisions;

	}

	private Collection<? extends AbstractLandUseSubdivision<?>> getSubdivisions(LandUseCategoryEnum landUseCategory) {

		List<AbstractLandUseSubdivision<?>> luSubdivisions = getJdbcTemplate().query(
				"select " + LU_SUBDIVISION + "," + LU_SUBDIVISION_LABEL + " from " + schemaName + LU_SUBDIVISION_TABLE
						+ " where " + LU_CATEGORY_ID + " IN ( select " + LU_CATEGORY_ID + " from " + schemaName
						+ LU_TABLE + " where " + LU_CATEGORY_COLUMN + " = '" + landUseCategory.getCode() + "'" + ")",
				getRowMapper(landUseCategory));

		return luSubdivisions;
	}

	private RowMapper<AbstractLandUseSubdivision<?>> getRowMapper(LandUseCategoryEnum landUseCategory) {
		return new RowMapper<AbstractLandUseSubdivision<?>>() {
			@Override
			public AbstractLandUseSubdivision<?> mapRow(ResultSet rs, int rowNum) throws SQLException {

				String subdivisionCode = rs.getString(1);
				String subdivisionName = rs.getString(2);

				Integer seqId = rowNum + 1;

				switch (landUseCategory.getCode()) {
				case "F":
					return new ForestSubdivision(subdivisionCode, subdivisionName, ManagementTypeEnum.MANAGED, // Assign
																												// default
																												// management
							seqId, ForestTypeEnum.OTHER_CONIF);
				case "C":
					return new CroplandSubdivision(subdivisionCode, subdivisionName, CroplandTypeEnum.ANNUAL, // Assign
																												// default
																												// management
							seqId);
				case "G":
					return new GrasslandSubdivision(subdivisionCode, subdivisionName, ManagementTypeEnum.MANAGED, // Assign
																													// default
																													// management
							seqId, VegetationTypeEnum.SV);
				case "S":
					return new SettlementSubdivision(subdivisionCode, subdivisionName, SettlementTypeEnum.OTHER, // Assign
																													// default
																													// management
							seqId);
				case "W":
					return new WetlandSubdivision(subdivisionCode, subdivisionName, ManagementTypeEnum.UNMANAGED, // Assign
																													// default
																													// management
							seqId);
				case "O":
					return new OtherlandSubdivision(subdivisionCode, subdivisionName, ManagementTypeEnum.UNMANAGED, // Assign
																													// default
																													// management
							seqId);
				default:
					throw new IllegalArgumentException("Unknown code " + landUseCategory.getCode());
				}

			}
		};
	}

}
