package org.openforis.collect.earth.ipcc.model;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.opencsv.CSVReader;

public class CountryUtils {

	
	private static Logger logger = LoggerFactory.getLogger( CountryUtils.class ); 

	public static CountryCode[] getCountryList(){
		File csvCountries= new File("resources/CountryList.csv");
		List<CountryCode> countries = new ArrayList<>();
		// UTF-8 : the file holds Curaçao, Côte d'Ivoire, Réunion, Saint-Barthélemy and Åland Islands, and with the charset
		// of the machine their names reached the wizard, and the exports, unreadable
		try( Reader csvFileReader = new InputStreamReader(new FileInputStream(csvCountries), StandardCharsets.UTF_8)){
			CSVReader reader = new CSVReader(csvFileReader);
			reader.skip(1);
			reader.forEach(t -> countries.add( new CountryCode(t[0], t[1])) );
		} catch (FileNotFoundException e) {
			logger.error("Error file not found", e);
		} catch (IOException e) {
			logger.error("Error reading the file", e);
		}
		CountryCode[] countriesArray = new CountryCode[ countries.size()];
		countries.toArray( countriesArray );
		return countriesArray;
	}
	
}
