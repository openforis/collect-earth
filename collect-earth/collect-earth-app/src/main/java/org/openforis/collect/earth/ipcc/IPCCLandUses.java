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
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandType;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.ManagementType;
import org.openforis.collect.earth.ipcc.model.OtherlandSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementType;
import org.openforis.collect.earth.ipcc.model.WetlandSubdivision;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class IPCCLandUses extends RDBConnector {

	private String schemaName;
	private static final String LU_CATEGORY_COLUMN = "land_uses_category";
	private static final String LU_TABLE = LU_CATEGORY_COLUMN + "_code";
	private static final String LU_SUBDIVISION ="land_uses_subdivision";
	private static final String LU_SUBDIVISION_LABEL = LU_SUBDIVISION + "_label";
	private static final String LU_SUBDIVISION_TABLE = LU_SUBDIVISION + "_code";
	private static final String LU_CATEGORY_ID = LU_TABLE +"_id";

	Logger logger = LoggerFactory.getLogger(IPCCLandUses.class);

	@Autowired
	private SchemaService schemaService;
	
	@Autowired
	private EarthSurveyService earthSurveyService;
	
	private List<LandUseSubdivision> landUseSubdivisions;


	public IPCCLandUses() {
		setExportTypeUsed(ExportType.IPCC);
	}

	public List<LandUseSubdivision> getLandUseSubdivisions() {

		if( landUseSubdivisions != null ) {
			return landUseSubdivisions;
		}
		
		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());

		LandUseCategory[] lUseCategories = LandUseCategory.values();

		landUseSubdivisions = new ArrayList<LandUseSubdivision>();

		for (int i = 0; i < lUseCategories.length; i++) {
			
			landUseSubdivisions.addAll( getSubdivisions(lUseCategories[i]));
			
		}

		return landUseSubdivisions;

	}
	
	private Collection<? extends LandUseSubdivision<?>> getSubdivisions(LandUseCategory landUseCategory) {
	
		List<LandUseSubdivision<?>> luSubdivisions = getJdbcTemplate().query(
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

	private RowMapper<LandUseSubdivision<?>> getRowMapper(LandUseCategory landUseCategory) {
		return new RowMapper<LandUseSubdivision<?>>() {
			@Override
			public LandUseSubdivision<?> mapRow(ResultSet rs, int rowNum) throws SQLException {
				
				String subdivisionCode = rs.getString(1);
				String subdivisionName = rs.getString(2);
				
				switch (landUseCategory.getCode()) {
					case "F":
						return new ForestSubdivision(
								subdivisionCode,
								subdivisionName,
								ManagementType.MANAGED // Assign default management
								);
					case "C":
						return new CroplandSubdivision(
								subdivisionCode,
								subdivisionName,
								CroplandType.ANNUAL // Assign default management
								);
					case "G":
						return new GrasslandSubdivision(
								subdivisionCode,
								subdivisionName,
								ManagementType.MANAGED // Assign default management
								);
					case "S":
						return new SettlementSubdivision(
								subdivisionCode,
								subdivisionName,
								SettlementType.OTHER // Assign default management
								);
					case "W":
						return new WetlandSubdivision(
								subdivisionCode,
								subdivisionName,
								ManagementType.UNMANAGED // Assign default management
								);
					case "O":
						return new OtherlandSubdivision(
								subdivisionCode,
								subdivisionName,
								ManagementType.UNMANAGED // Assign default management
								);
				default:
					throw new IllegalArgumentException("Unknown code " + landUseCategory.getCode() );
				}
				
			}
		};
	}

}
