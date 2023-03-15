package org.openforis.collect.earth.ipcc;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RDBConnector;
import org.openforis.collect.earth.app.service.SchemaService;
import org.openforis.collect.earth.ipcc.model.ClimateStratumObject;
import org.openforis.collect.earth.ipcc.model.SoilStratumObject;
import org.openforis.collect.earth.ipcc.model.StratumObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public abstract class AbstractIPCCDataExport extends RDBConnector {

	public static final String CLIMATE_COLUMN = "climate";
	public static final String GEZ_COLUMN = "gez";
	public static final String SOIL_COLUMN = "soil";
	
	public static final String CLIMATE = "climate";
	public static final String CLIMATE_COLUMN_VALUE = CLIMATE + "_zones";
	public static final String CLIMATE_TABLE = CLIMATE_COLUMN_VALUE + "_code";
	public static final String CLIMATE_COLUMN_LABEL = CLIMATE_COLUMN_VALUE + "_label";
	public static final String CLIMATE_COLUMN_ID = CLIMATE_COLUMN_VALUE + "_code_id";
	public static final String CLIMATE_COLUMN_IN_PLOT = CLIMATE +"_code_id";
	
	public static final String GEZ_COLUMN_VALUE = "ecological_zones";
	public static final String GEZ_TABLE = GEZ_COLUMN_VALUE + "_code";
	public static final String GEZ_COLUMN_LABEL = GEZ_COLUMN_VALUE + "_label";
	public static final String GEZ_COLUMN_ID = GEZ_COLUMN_VALUE + "_code_id";
	public static final String GEZ_COLUMN_IN_PLOT = "gez_code_id";
	
	public static final String SOIL = "soil";	
	public static final String SOIL_COLUMN_VALUE = SOIL + "_types";
	public static final String SOIL_TABLE = SOIL_COLUMN_VALUE + "_code";
	public static final String SOIL_COLUMN_LABEL = SOIL_COLUMN_VALUE + "_label";
	public static final String SOIL_COLUMN_ID = SOIL_COLUMN_VALUE + "_code_id";
	public static final String SOIL_COLUMN_IN_PLOT = SOIL + "_code_id";
	
	private String schemaName;
	public static final String PLOT_TABLE = "plot";
	public static final String PLOT_ID = "id";

	Logger logger = LoggerFactory.getLogger(AbstractIPCCDataExport.class);

	
	private List<ClimateStratumObject> climates;
	private List<SoilStratumObject> soils;
	private List<StratumObject> gezs;
	
	@Autowired
	private SchemaService schemaService;

	public AbstractIPCCDataExport() {
		setExportTypeUsed(ExportType.IPCC);
	}

	protected List<ClimateStratumObject> getStrataClimate() {
		
		if( climates == null ) {
			List<StratumObject> distinctClimates = distinctValue(CLIMATE_COLUMN_VALUE, CLIMATE_COLUMN_LABEL, CLIMATE_TABLE, CLIMATE_COLUMN_IN_PLOT);
			climates = new ArrayList<ClimateStratumObject>();
			for (StratumObject distinctClimate : distinctClimates) {
				climates.add( new ClimateStratumObject(distinctClimate.getValue(), distinctClimate.getLabel() ) );
			}
		}
		return climates;
		
	}

	protected List<SoilStratumObject> getStrataSoil() {
		if( soils == null ) {
			List<StratumObject> distinctSoils =  distinctValue(SOIL_COLUMN_VALUE, SOIL_COLUMN_LABEL, SOIL_TABLE, SOIL_COLUMN_IN_PLOT);
			soils = new ArrayList<SoilStratumObject>();
			for (StratumObject distinctSoil : distinctSoils) {
				soils.add( new SoilStratumObject(distinctSoil.getValue(), distinctSoil.getLabel() ) );
			}
			
		}
		return soils;
	}

	protected List<StratumObject> getStrataGEZ() {
		if( gezs == null ) {
			gezs = distinctValue(GEZ_COLUMN_VALUE, GEZ_COLUMN_LABEL, GEZ_TABLE, GEZ_COLUMN_IN_PLOT );
		}
		return gezs;
	}

	private List<StratumObject> distinctValue(String valueColumn, String labelColumn, String table, String plotColumnId) {

		return getJdbcTemplate().query(
				"SELECT DISTINCT(" + valueColumn  +"),"+ labelColumn +
				" FROM " + getSchemaName() + table + ", " + getSchemaName() + PLOT_TABLE +
				" WHERE " + PLOT_TABLE + "." + plotColumnId + " = " +  table + "." + table + "_id" 
				 , 
				new RowMapper<StratumObject>() {
					@Override
					public StratumObject mapRow(ResultSet rs, int rowNum) throws SQLException {

						return new StratumObject( rs.getString(valueColumn), rs.getString(labelColumn) );
					}

				});
	}

	protected String getSchemaName() {
		return schemaName;
	}

	protected void initSchemaName() {
		this.schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());
	}

}
