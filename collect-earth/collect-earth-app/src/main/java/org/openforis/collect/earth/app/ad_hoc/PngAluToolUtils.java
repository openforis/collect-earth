package org.openforis.collect.earth.app.ad_hoc;

import java.util.HashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;




public class PngAluToolUtils {
	
	
	/**
	 * Returns the climate zone code according to the ALU tool rules
	 * @param plotElevation The elevation at the plot center point in meters
	 * @param precipitation  The precipitation in mm per year 
	 * @param shortDrySeason If the dry season is shorter or equal to 5 months (true) or not
	 * @return
	 */
	public String getClimateZone( int elevation, int precipitation, boolean shortDrySeason ){
		
		String climateName = null;
		
		if(  elevation < 1000 && precipitation < 1000 ){ // Tropical Dry
			climateName = "TRD";
		}else if(  elevation < 1000 && ( precipitation >= 1000 &&  precipitation < 2000) && !shortDrySeason   ){ // Tropical Moist, Long Dry Season
			climateName = "TMLD";
		}else if(  elevation < 1000 && ( precipitation >= 1000 &&  precipitation < 2000) && shortDrySeason   ){ // Tropical Moist, Short Dry Season
			climateName = "TMSD";
		}else if(  elevation >= 1000 && precipitation < 1000 ){ // Tropical Montane Dry
			climateName = "TRMD";
		}else if(  elevation >= 1000 && precipitation >= 1000 ){ // Tropical Montane Moist
			climateName = "TRMM";
		}else if(  elevation < 1000 && precipitation >= 2000 ){ // Tropical Wet
			climateName = "TRW";
		}
		
		return climateName;
	}
	
	public String getSoilType( String initialSoilGroup ){
		String soilType = "N/A";
		if( StringUtils.isBlank(initialSoilGroup) ){
			return "N/A";
		}
		
		Map<String,String> fundamentalToSoilGroup = new HashMap<String,String>();
		
		fundamentalToSoilGroup.put("B", "HAC");
		fundamentalToSoilGroup.put("L", "HAC");
		fundamentalToSoilGroup.put("P", "VOL");
		fundamentalToSoilGroup.put("V", "VOL");
		fundamentalToSoilGroup.put("S", "SAN"); // SAN+POD
		fundamentalToSoilGroup.put("Z", "LAC"); // LAc+HAC
		fundamentalToSoilGroup.put("T", "SAN");
		fundamentalToSoilGroup.put("A", "LAC"); // LAC+WET
		fundamentalToSoilGroup.put("C", "LAC");
		fundamentalToSoilGroup.put("G", "LAC"); // LAC+HAC
		fundamentalToSoilGroup.put("W", "ORG"); // ORG+WET
		fundamentalToSoilGroup.put("M", "WET");
		
		soilType = fundamentalToSoilGroup.get(initialSoilGroup);
		return soilType;
	}
	
	
	public String getAluSubclass( String collectEarthSubclass ){
		if( StringUtils.isBlank(collectEarthSubclass) ){
			return "N/A";
		}
		String aluSubClass = collectEarthSubclass.replace("to", "");
		aluSubClass = aluSubClass.replace("L", "");
		aluSubClass = aluSubClass.replace("T", "");
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
