package org.openforis.collect.earth.ipcc.controller;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.LandUseManagement;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.OtherlandSubdivision;
import org.openforis.collect.earth.ipcc.model.SettlementSubdivision;
import org.openforis.collect.earth.ipcc.model.WetlandSubdivision;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.thoughtworks.xstream.XStream;


public class LandUseSubdivisionUtils {
	
	private static Logger logger = LoggerFactory.getLogger( LandUseSubdivisionUtils.class );
	
	static List<LandUseSubdivision> landUseSubdivisions;

	public static List<LandUseSubdivision<?>> getSubdivisionsByCategory(LandUseCategory category) {
		List<LandUseSubdivision<?>> subdivisionsInCategory = new ArrayList<LandUseSubdivision<?>>();
		for (LandUseSubdivision<?> landUseSubdivision : landUseSubdivisions) {
			if( landUseSubdivision.getCategory().equals( category ) ) {
				subdivisionsInCategory.add(landUseSubdivision);
			}
		}
		
		return subdivisionsInCategory;
	}
	
	public static List<LandUseSubdivision<?>> getSubdivisionsByCategoryAndType(LandUseManagement landUseManagement) {
		List<LandUseSubdivision<?>> subdivisionsInCategoryAndType = new ArrayList<LandUseSubdivision<?>>();
		for (LandUseSubdivision<?> landUseSubdivision : landUseSubdivisions) {
			if( 
					landUseSubdivision.getCategory().equals( landUseManagement.getLuCategory() ) 
					&& 
					landUseSubdivision.getManagementType().equals( landUseManagement.getManagementType() ) 
			) {
				subdivisionsInCategoryAndType.add(landUseSubdivision);
			}
		}
		
		return subdivisionsInCategoryAndType;
	}
	
	public static void setSubdivisionType(LandUseSubdivision subdivision, Object type) {
		landUseSubdivisions.get( landUseSubdivisions.indexOf(subdivision)).setManagementType( type);
	}

	public static List<LandUseSubdivision> getLandUseSubdivisions() {
		return landUseSubdivisions;
	}

	public static void setLandUseSubdivisions(List<LandUseSubdivision> landUseSubdivisions) {
		LandUseSubdivisionUtils.landUseSubdivisions = landUseSubdivisions;
	}
	
	public static LandUseSubdivision<?> getSubdivision( String luCategoryCode, String luSubdivisionCode  ) {
		
		LandUseCategory[] luCategories = LandUseCategory.values();
		LandUseCategory landUseCategory = null;
		for (LandUseCategory luCat : luCategories) {
			if( luCat.getCode().equals(luCategoryCode)) {
				landUseCategory = luCat;
			}
		}
		
		for (LandUseSubdivision<?> landUseSubdiv : landUseSubdivisions) {
			if( landUseSubdiv.getCategory().equals(landUseCategory) && landUseSubdiv.getCode().equals( luSubdivisionCode ) ) {
				return landUseSubdiv;
			}
			
		}
		
		logger.info("No LU Subdivision found for category : " + luCategoryCode + " / subdivision code : " + luSubdivisionCode );
		return null;
	}
	
	public static File getSubdivisionsXML() throws IOException {
		XStream xStream = new XStream();
		
		final String subdivisionLabel =  "Subdivision";
		
		xStream.alias(subdivisionLabel, ForestSubdivision.class);
		xStream.alias(subdivisionLabel, CroplandSubdivision.class);
		xStream.alias(subdivisionLabel, SettlementSubdivision.class);
		xStream.alias(subdivisionLabel, OtherlandSubdivision.class);
		xStream.alias(subdivisionLabel, GrasslandSubdivision.class);
		xStream.alias(subdivisionLabel, WetlandSubdivision.class);
		
		xStream.setMode(XStream.NO_REFERENCES);
		String xmlSchema = xStream.toXML(getLandUseSubdivisions());
		
		File xmlFileDestination = File.createTempFile( "subdivisionsInSurvey", ".xml" );
		xmlFileDestination.deleteOnExit();
		try (FileOutputStream outputStream = new FileOutputStream( xmlFileDestination ) ) {
			byte[] strToBytes = xmlSchema.getBytes();
			outputStream.write(strToBytes);
		} catch (Exception e) {
			logger.error("Error saving data to file", e);
		}
		
		return xmlFileDestination;
	}

}
