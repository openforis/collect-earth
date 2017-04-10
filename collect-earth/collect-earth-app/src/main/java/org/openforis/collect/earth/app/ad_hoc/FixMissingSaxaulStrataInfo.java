package org.openforis.collect.earth.app.ad_hoc;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import au.com.bytecode.opencsv.CSVReader;

@Component
public class FixMissingSaxaulStrataInfo {

	String saxaulPlots= "SaxaulStrataPlots.csv"; //$NON-NLS-1$
	Logger logger = LoggerFactory.getLogger(FixMissingSaxaulStrataInfo.class);
	
	@Autowired
	private EarthSurveyService earthSurveyService;
	
	protected CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8"))); //$NON-NLS-1$
		reader = new CSVReader(bufferedReader, ',');
		return reader;
	}
	
	private List<String> getAllSaxaulIds(){
		List<String> saxaulIds = new ArrayList<String>();
		try {
			CSVReader saxaulCsvReader = getCsvReader(saxaulPlots);
			String[] csvRow;
			while ((csvRow = saxaulCsvReader.readNext()) != null ) {
				saxaulIds.add( csvRow[0]);
			}
		} catch (FileNotFoundException e) {
			logger.error("Error reading Saxaul file", e ); //$NON-NLS-1$
		} catch (IOException e) {
			logger.error("Error reading CSV line", e ); //$NON-NLS-1$
		}
		
		
		return saxaulIds;
	}
	
	public void setSaxaulStrata(){
		List<String> allSaxaulIds = getAllSaxaulIds();
		for (String plotId : allSaxaulIds) {
			if( plotId.startsWith("sax") ){ //$NON-NLS-1$
				setPlotValue(plotId,"collect_text_strata","Pure Saxaul"); //$NON-NLS-1$ //$NON-NLS-2$
			}else{
				setPlotValue(plotId,"collect_text_strata","Saxaul & Systematic"); //$NON-NLS-1$ //$NON-NLS-2$
			}
		}
	}

	@SuppressWarnings("deprecation")
	private void setPlotValue(String plotId, String collectParameterName, String value) {
		Map<String,String> plotInformation = earthSurveyService.getPlacemark( new String[]{plotId},true);
		if( plotInformation.get( EarthConstants.PLACEMARK_FOUND_PARAMETER ).trim().equals("true") ){ //$NON-NLS-1$
			plotInformation.put(collectParameterName, value);
			earthSurveyService.storePlacemarkOld(plotInformation);
		}
	}
}
