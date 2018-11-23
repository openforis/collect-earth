package org.openforis.collect.earth.sampler.utils;

import java.io.File;
import java.io.IOException;

import org.geotools.referencing.GeodeticCalculator;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;

import au.com.bytecode.opencsv.CSVReader;

public class CheckDistances {

	public static void main(String[] args) {

		File csvFile = new File( "C:\\Users\\SanchezPausDiaz\\Downloads\\ecuador.csv");
		if( csvFile.exists() ){
			CSVReader reader = null;
			try {

				reader = CsvReaderUtils.getCsvReader(csvFile.getAbsolutePath());
				String[] csvRow = reader.readNext();

				while ( csvRow != null ) {
					try {				
						double[] coordinates0 = {new Double(csvRow[1]),	new Double(csvRow[2])};
						if( (csvRow = reader.readNext()) !=null){
							double[] coordinates1 = {new Double(csvRow[1]),	new Double(csvRow[2])};

							final GeodeticCalculator calc = new GeodeticCalculator(DefaultGeographicCRS.WGS84);

							calc.setStartingGeographicPoint( coordinates0[1], coordinates0[0]);
							calc.setDestinationGeographicPoint( coordinates1[1], coordinates1[0]);
							System.out.print( ( coordinates0[0] - coordinates1[0] ) + " " +  ( coordinates0[1] - coordinates1[1] ) + "  :  " );
							System.out.println( calc.getOrthodromicDistance() );
							
						}else{
							System.out.println( "Last row!!!" );
							break;
						}
					}catch(Exception e){
						csvRow = reader.readNext();
						e.printStackTrace();
						
					}
				}

			}catch(Exception e){
				e.printStackTrace();
			}finally{
				try {
					reader.close();
				} catch (IOException e) {
					// TODO Auto-generated catch block
					e.printStackTrace();
				}
			}
		}else{
			System.out.println("CSV file not found " + csvFile.getAbsolutePath());
		}
	}



}
