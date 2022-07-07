package org.openforis.collect.earth.ipcc.controller;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.ipcc.model.LandUseCategory;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;

public class LandUseSubdivisionUtils {
	
	static List<LandUseSubdivision> landUseSubdivisions;

	public static List<LandUseSubdivision> getSubdivisionsByCategory(LandUseCategory category) {
		List<LandUseSubdivision> subdivisionsInCategory = new ArrayList<LandUseSubdivision>();
		for (LandUseSubdivision landUseSubdivision : landUseSubdivisions) {
			if( landUseSubdivision.getCategory().equals( category ) ) {
				subdivisionsInCategory.add(landUseSubdivision);
			}
		}
		
		return subdivisionsInCategory;
	}
	
	public static void setSubdivisionType(LandUseSubdivision subdivision, Object type) {
		landUseSubdivisions.get( landUseSubdivisions.indexOf(subdivision)).setType(type);
	}

	public static List<LandUseSubdivision> getLandUseSubdivisions() {
		return landUseSubdivisions;
	}

	public static void setLandUseSubdivisions(List<LandUseSubdivision> landUseSubdivisions) {
		LandUseSubdivisionUtils.landUseSubdivisions = landUseSubdivisions;
	}

}
