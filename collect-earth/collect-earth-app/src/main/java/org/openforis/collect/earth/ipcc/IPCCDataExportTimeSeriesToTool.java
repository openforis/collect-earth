package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

import javax.xml.datatype.Duration;
import javax.xml.datatype.XMLGregorianCalendar;
import javax.xml.namespace.QName;

import org.eclipse.emf.ecore.xml.type.internal.XMLCalendar;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.ipcc.controller.LandUseSubdivisionUtils;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivisionStratified;
import org.openforis.collect.earth.ipcc.model.StratumObject;
import org.openforis.collect.earth.ipcc.serialize.ClimateRegion;
import org.openforis.collect.earth.ipcc.serialize.ClimateRegions;
import org.openforis.collect.earth.ipcc.serialize.IPCC2006Export;
import org.openforis.collect.earth.ipcc.serialize.IPCC2006Export.Record;
import org.openforis.collect.earth.ipcc.serialize.LandTypes;
import org.openforis.collect.earth.ipcc.serialize.SoilType;
import org.openforis.collect.earth.ipcc.serialize.SoilTypes;
import org.openforis.collect.manager.SurveyManager;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import com.thoughtworks.xstream.XStream;

@Component
public class IPCCDataExportTimeSeriesToTool extends IPCCDataExportTimeSeries<LUDataPerYear> {
	
	@Autowired
	protected SurveyManager surveyManager;
	
	
	public File generateTimeseriesData( int startYear, int endYear, String countryCode ) throws IOException {
		initSchemaName();

		List<File> xmlInventoryPerYear = new ArrayList<>();
				
		for (int year = startYear; year < endYear; year++) {

			IPCC2006Export ipcc2006Export = new IPCC2006Export();
			ipcc2006Export.setCountryCode(countryCode);
			ipcc2006Export.setVersion("2.83");
			ipcc2006Export.setInventoryYear( new XMLCalendar( year + "", XMLCalendar.GYEAR));
	

			Record record = new Record();
			LandTypes landTypes = new LandTypes();

			List<StratumObject> strataClimate = getStrataClimate();
			List<StratumObject> strataSoil = getStrataSoil();
			List<StratumObject> strataGEZ = getStrataGEZ();
			
			ClimateRegions climateRegions = new ClimateRegions();
			for (StratumObject climate : strataClimate) {
				ClimateRegion climateRegion = new ClimateRegion();
				climateRegion.setGuid( UUID.randomUUID().toString());
				climateRegion.setId( BigInteger.valueOf( Long.parseLong( climate.getValue() ) ) );
				climateRegion.setRemark(climate.getValue() );
				climateRegions.getClimateRegion().add(climateRegion);
			}
			landTypes.setClimateRegions(climateRegions);
						
			SoilTypes soilTypes = new SoilTypes();
			for (StratumObject soil : strataSoil) {
				SoilType soilType = new SoilType();
				soilType.setGuid( UUID.randomUUID().toString());
				soilType.setId( BigInteger.valueOf( Long.parseLong( soil.getValue() ) ) );
				soilType.setRemark(soil.getValue() );
				soilTypes.getSoilType().add(soilType);
			}
			landTypes.setSoilTypes(soilTypes);

			record.setLandTypes(landTypes);
			ipcc2006Export.getRecord().add(record);
			
			File ipccInventroyYearTemp = generateXMLFile( ipcc2006Export, year );
			xmlInventoryPerYear.add(ipccInventroyYearTemp);
		}
			
			
	/*
			E yearLuData = (E) generateLUTimeseriesForStrata(year, gez, climate, soil);
			if (yearLuData != null)
				strataData.add(yearLuData);
			List<E> strataData = new ArrayList<E>();

			
			
			for (StratumObject gez : strataGEZ) {
				for (StratumObject climate : strataClimate) {
					for (StratumObject soil : strataSoil) {
						E yearLuData = (E) generateLUTimeseriesForStrata(year, gez, climate, soil);
						if (yearLuData != null)
							strataData.add(yearLuData);
					}
				}
			}
		}
*/
		return generateFile( strataData);


	}

	private List<LandUseSubdivisionStratified> climateSoileLandUseCombination(String ipccCategory, int year, String valueColumn, String labelColumn, String table, String plotColumnId) {

		
		return getJdbcTemplate().query(
				
				"select "
					+ "DISTINCT(" 
						+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + ", "
						+ CLIMATE_COLUMN + ", " + SOIL_COLUMN + ", " + GEZ_COLUMN   
					+ ")" 
					+ " from " + getSchemaName() + PLOT_TABLE 
					+ " where " 
					+ IPCCSurveyAdapter.getIpccSubdivisionAttrName(year) + " + " + ipccCategory
					
					,
					
				
					new RowMapper<LandUseSubdivisionStratified>() {
						@Override
						public LandUseSubdivisionStratified mapRow(ResultSet rs, int rowNum) throws SQLException {
		
							String landUseSubdivision = rs.getString(1);
							Integer climate = rs.getInt(2);
							Integer soil = rs.getInt(3);
							Integer gz = rs.getInt(4);
														
							return new LandUseSubdivisionStratified( landUseSubdivision, climate, soil );
						}
		
					});
					
		
	}
	

	private File marshallToTempFile(IPCC2006Export ipcc2006Export) {
		// TODO Auto-generated method stub
		return null;
	}


	@Override
	protected RowMapper<LUDataPerYear> getRowMapper() {
		return new RowMapper<LUDataPerYear>() {
			@Override
			public LUDataPerYear mapRow(ResultSet rs, int rowNum) throws SQLException {
				
				String categoryInitial = rs.getString(1);
				String categoryFinal = rs.getString(2);
				String subdivInitial = rs.getString(3);
				String subdivFinal = rs.getString(4);
				
				return new LUDataPerYear(
						LandUseSubdivisionUtils.getSubdivision(categoryInitial, subdivInitial),
						LandUseSubdivisionUtils.getSubdivision(categoryFinal, subdivFinal),
						rs.getDouble(5) // area
						);
			}
		};
	}


	protected File generateXMLFile( IPCC2006Export ipcc2006Export, int year) throws IOException {
		File xmlFileDestination = File.createTempFile("ghgiActivityData_"+year, ".xml");
		xmlFileDestination.deleteOnExit();
		XStream xStream = new XStream();
		xStream.setMode(XStream.NO_REFERENCES);

		String xmlSchema = xStream.toXML(ipcc2006Export);
				
		try (FileOutputStream outputStream = new FileOutputStream( xmlFileDestination ) ) {
			byte[] strToBytes = xmlSchema.getBytes();
			outputStream.write(strToBytes);
		} catch (Exception e) {
			logger.error("Error saving data to file", e);
		}
				
		return xmlFileDestination;
	}
}
