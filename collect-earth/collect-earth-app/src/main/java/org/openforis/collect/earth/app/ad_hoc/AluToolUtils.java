package org.openforis.collect.earth.app.ad_hoc;

import java.util.HashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;




public class AluToolUtils {
	
	
	/**
	 * Returns the climate zone code according to the ALU tool rules
	 * @param elevation The elevation at the plot center point in meters
	 * @param precipitation  The precipitation in mm per year 
	 * @param shortDrySeason If the dry season is shorter or equal to 5 months (true) or not
	 * @return The climate zone according to the ALU tool documentation
	 */
	public String getClimateZone( int elevation, int precipitation, boolean shortDrySeason ){
		
		String climateName = null;
		
		if(  elevation < 1000 && precipitation < 1000 ){ // Tropical Dry
			climateName = "TRD"; //$NON-NLS-1$
		}else if(  elevation < 1000 && ( precipitation >= 1000 &&  precipitation < 2000) && !shortDrySeason   ){ // Tropical Moist, Long Dry Season
			climateName = "TMLD"; //$NON-NLS-1$
		}else if(  elevation < 1000 && ( precipitation >= 1000 &&  precipitation < 2000) && shortDrySeason   ){ // Tropical Moist, Short Dry Season
			climateName = "TMSD"; //$NON-NLS-1$
		}else if(  elevation >= 1000 && precipitation < 1000 ){ // Tropical Montane Dry
			climateName = "TRMD"; //$NON-NLS-1$
		}else if(  elevation >= 1000 && precipitation >= 1000 ){ // Tropical Montane Moist
			climateName = "TRMM"; //$NON-NLS-1$
		}else if(  elevation < 1000 && precipitation >= 2000 ){ // Tropical Wet
			climateName = "TRW"; //$NON-NLS-1$
		}
		
		return climateName;
	}
	
	public String getSoilType( String initialSoilGroup ){
		String soilType = "N/A"; //$NON-NLS-1$
		if( StringUtils.isBlank(initialSoilGroup) ){
			return "N/A"; //$NON-NLS-1$
		}
		
		Map<String,String> fundamentalToSoilGroup = new HashMap<String,String>();
		
		fundamentalToSoilGroup.put("B", "HAC"); //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("L", "HAC"); //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("P", "VOL"); //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("V", "VOL"); //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("S", "SAN"); // SAN+POD //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("Z", "LAC"); // LAc+HAC //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("T", "SAN"); //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("A", "LAC"); // LAC+WET //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("C", "LAC"); //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("G", "LAC"); // LAC+HAC //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("W", "ORG"); // ORG+WET //$NON-NLS-1$ //$NON-NLS-2$
		fundamentalToSoilGroup.put("M", "WET"); //$NON-NLS-1$ //$NON-NLS-2$
		
		soilType = fundamentalToSoilGroup.get(initialSoilGroup);
		return soilType;
	}
	
	
	public String getAluSubclass( String collectEarthSubclass ){
		if( StringUtils.isBlank(collectEarthSubclass) ){
			return "N/A"; //$NON-NLS-1$
		}
		String aluSubClass = collectEarthSubclass.replace("to", ""); //$NON-NLS-1$ //$NON-NLS-2$
		aluSubClass = aluSubClass.replace("L", ""); //$NON-NLS-1$ //$NON-NLS-2$
		aluSubClass = aluSubClass.replace("T", ""); //$NON-NLS-1$ //$NON-NLS-2$
		return aluSubClass;
	}
	
	/**
	 * Returns the lower bracket of the precipitation range
	 * @param precipitationRange expects values like "0-100" or "2000-2100"
	 * @return the lowest bracket of the range. So for "0-100" it would return 0
	 */
	public Integer getPrecipitationFromRange(String precipitationRange){
		String lowerBracket = precipitationRange.substring(0, precipitationRange.indexOf('-')).trim();
		if( lowerBracket.length() > 0 ){
			return Integer.parseInt(lowerBracket);
		}else{
			return -1;
		}
	}

}
