package org.openforis.collect.earth.sampler.utils;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

import org.apache.commons.lang3.ArrayUtils;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;
import au.com.bytecode.opencsv.CSVWriter;

public class ProduceGridWithOffset {
	
	public static void main(String[] args)  {
				

		ProduceGridWithOffset produceGridWithOffset = new ProduceGridWithOffset();
		produceGridWithOffset.addTransformedColumns( new File("C:\\opt\\workspaceClean\\CsvSorter\\All_Points_Grid_corrected.csv") );

		
	}

	private Logger logger = LoggerFactory.getLogger(this.getClass());

	public void addTransformedColumns(  File gridFile ){
		CSVReader csvReader =null;
		try {
			csvReader = CsvReaderUtils.getCsvReader(gridFile.getPath());
			
			File fileOutput = new File( gridFile.getParent(), "All_Points_Grid_corrected_50moffset.csv" );
			CSVWriter writer = new CSVWriter( new FileWriter( fileOutput  ) );
			
			String[] csvContents = null;
			while( ( csvContents = csvReader.readNext() )  !=null ){
				try{
					double latitude = Double.valueOf(csvContents[1]);
					double longitude = Double.valueOf(csvContents[2]);
					double[] pointWithOffset;
					try {
						pointWithOffset = CoordinateUtils.getPointWithOffset( new double[]{ latitude, longitude}, 50, 50);
						
						csvContents[1] = pointWithOffset[0] + "";
						csvContents[2] = pointWithOffset[1] + "";
						
						writer.writeNext(csvContents);
					} catch (TransformException e) {
						logger.error(" Error transforming the point coordinates " + ArrayUtils.toString( csvContents ) );
					}
				}catch(Exception e ){
					logger.error(" Error reading the coord values " + ArrayUtils.toString( csvContents ) );
					writer.writeNext(csvContents);
				}
				
				
			}
			writer.close();
		} catch (IOException e) {
			logger.error(" Error reading the file " + gridFile );
		} finally {
			try {
				csvReader.close();
			} catch (IOException e) {
				// TODO Auto-generated catch block
				e.printStackTrace();
			}
		}
		
	}

}
