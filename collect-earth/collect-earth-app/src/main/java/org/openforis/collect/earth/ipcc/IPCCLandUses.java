package org.openforis.collect.earth.ipcc;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class IPCCLandUses extends RDBConnector {

	private String schemaName;
	private static final String LU_CATEGORY_COLUMN = IPCCSurveyAdapter.CODE_LIST_LAND_USE + "_use"; // _category
	private static final String LU_TABLE = LU_CATEGORY_COLUMN + "_code";
	private static final String LU_SUBDIVISION =IPCCSurveyAdapter.CODE_LIST_LAND_USE +  "_subdivision";
	private static final String LU_SUBDIVISION_LABEL = LU_SUBDIVISION + "_label";
	private static final String LU_SUBDIVISION_TABLE = LU_SUBDIVISION + "_code";
	private static final String LU_CATEGORY_ID = LU_TABLE +"_id";

	Logger logger = LoggerFactory.getLogger(IPCCLandUses.class);

	@Autowired
	private SchemaService schemaService;

	private List<AbstractLandUseSubdivision> landUseSubdivisions;

	public IPCCLandUses() {
		setExportTypeUsed(ExportType.IPCC);
	}

	public List<AbstractLandUseSubdivision> getLandUseSubdivisions() {

		if( landUseSubdivisions != null ) {
			return landUseSubdivisions;
		}
		
		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());

		LandUseCategoryEnum[] lUseCategories = LandUseCategoryEnum.values();

		landUseSubdivisions = new ArrayList<AbstractLandUseSubdivision>();

		for (int i = 0; i < lUseCategories.length; i++) {
			
			landUseSubdivisions.addAll( getSubdivisions(lUseCategories[i]));
			
		}

		return landUseSubdivisions;

	}
	
	private Collection<? extends AbstractLandUseSubdivision<?>> getSubdivisions(LandUseCategoryEnum landUseCategory) {
	
		List<AbstractLandUseSubdivision<?>> luSubdivisions = getJdbcTemplate().query(
				"select " 
					+ LU_SUBDIVISION + "," + LU_SUBDIVISION_LABEL
					+ " from " + schemaName + LU_SUBDIVISION_TABLE
					+ " where " + LU_CATEGORY_ID
						+ " IN ( select " + LU_CATEGORY_ID
								+ " from " + schemaName + LU_TABLE
								+ " where " + LU_CATEGORY_COLUMN + " = '" + landUseCategory.getCode()+ "'"
						+ ")"
				,
				getRowMapper(landUseCategory)
			);

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
						return new ForestSubdivision(
								subdivisionCode,
								subdivisionName,
								ManagementTypeEnum.MANAGED, // Assign default management
								seqId,
								ForestTypeEnum.OTHER_CONIF
								);
					case "C":
						return new CroplandSubdivision(
								subdivisionCode,
								subdivisionName,
								CroplandTypeEnum.ANNUAL, // Assign default management
								seqId
								);
					case "G":
						return new GrasslandSubdivision(
								subdivisionCode,
								subdivisionName,
								ManagementTypeEnum.MANAGED, // Assign default management
								seqId,
								VegetationTypeEnum.SV 
								);
					case "S":
						return new SettlementSubdivision(
								subdivisionCode,
								subdivisionName,
								SettlementTypeEnum.OTHER, // Assign default management
								seqId
								);
					case "W":
						return new WetlandSubdivision(
								subdivisionCode,
								subdivisionName,
								ManagementTypeEnum.UNMANAGED, // Assign default management
								seqId
								);
					case "O":
						return new OtherlandSubdivision(
								subdivisionCode,
								subdivisionName,
								ManagementTypeEnum.UNMANAGED, // Assign default management
								seqId
								);
				default:
					throw new IllegalArgumentException("Unknown code " + landUseCategory.getCode() );
				}
				
			}
		};
	}

}
