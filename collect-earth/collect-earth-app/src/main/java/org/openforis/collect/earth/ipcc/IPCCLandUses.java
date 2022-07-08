package org.openforis.collect.earth.ipcc;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RDBConnector;
import org.openforis.collect.earth.app.service.SchemaService;
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.OtherlandSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementSubdivision;
import org.openforis.collect.earth.ipcc.model.WetlandSubdivision;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class IPCCLandUses extends RDBConnector {

	private String schemaName;
	private static final String LU_TABLE = "land_use_use_code";
	private static final String LU_CODE_COLUMN = "land_use_use";
	private static final String LU_SUBDIVISION_TABLE = "land_use_subdivision_code";
	private static final String LU_CATEGORY_ID = LU_TABLE +"_id";

	Logger logger = LoggerFactory.getLogger(IPCCLandUses.class);

	@Autowired
	private SchemaService schemaService;


	public IPCCLandUses() {
		setExportTypeUsed(ExportType.IPCC);
	}

	public List<LandUseSubdivision> getLandUseSubdivisions() {

		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());

		LandUseCategory[] lUseCategories = LandUseCategory.values();

		List<LandUseSubdivision> lUseSubdivisions = new ArrayList<LandUseSubdivision>();

		for (int i = 0; i < lUseCategories.length; i++) {
			
			lUseSubdivisions.addAll( getSubdivisions(lUseCategories[i]));
			
		}

		return lUseSubdivisions;

	}

	private Collection<? extends LandUseSubdivision> getSubdivisions(LandUseCategory landUseCategory) {

		List<LandUseSubdivision> luSubdivisions = getJdbcTemplate().query(
				"select " 
					+ "land_use_subdivision,land_use_subdivision_label_fr"
					+ " from " + schemaName + LU_SUBDIVISION_TABLE
					+ " where " + LU_CATEGORY_ID
						+ " IN ( select " + LU_CATEGORY_ID
								+ " from " + schemaName + LU_TABLE
								+ " where " + LU_CODE_COLUMN + " = '" + landUseCategory.getCode()+ "'"
						+ ")"
				,
				getRowMapper(landUseCategory)
			);

		return luSubdivisions;
	}

	private RowMapper<LandUseSubdivision> getRowMapper(LandUseCategory landUseCategory) {
		return new RowMapper<LandUseSubdivision>() {
			@Override
			public LandUseSubdivision mapRow(ResultSet rs, int rowNum) throws SQLException {
				switch (landUseCategory.getCode()) {
					case "F":
						return new ForestSubdivision(
								rs.getString(1),
								rs.getString(2),
								null
								);
					case "C":
						return new CroplandSubdivision(
								rs.getString(1),
								rs.getString(2),
								null
								);
					case "G":
						return new GrasslandSubdivision(
								rs.getString(1),
								rs.getString(2),
								null
								);
					case "S":
						return new SettlementSubdivision(
								rs.getString(1),
								rs.getString(2),
								null
								);
					case "W":
						return new WetlandSubdivision(
								rs.getString(1),
								rs.getString(2),
								null
								);
					case "O":
						return new OtherlandSubdivision(
								rs.getString(1),
								rs.getString(2),
								null
								);
				default:
					new IllegalArgumentException("Unknown code " + landUseCategory.getCode() );
					break;
				}
				return null;
				
			}
		};
	}

}
