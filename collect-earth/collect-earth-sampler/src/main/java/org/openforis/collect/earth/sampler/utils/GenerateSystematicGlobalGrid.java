package org.openforis.collect.earth.sampler.utils;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVWriter;

public class GenerateSystematicGlobalGrid{

	public static void main(String[] args)  {


		GenerateSystematicGlobalGrid globalGrid = new GenerateSystematicGlobalGrid();
		globalGrid.generate();


	}

	private static final Integer DISTANCE_BETWEEN_PLOTS_IN_METERS = 10000;

	private static final Double STARTING_LONGITUDE = -169d;

	private static final Double STARTING_LATITUDE = 85d;

	private static final Double ENDING_LATITUDE = -85d;

	private Logger logger = LoggerFactory.getLogger(this.getClass());

	public void generate(){

		CSVWriter writer = null;

		Double latitude = STARTING_LATITUDE;
		Double longitude = STARTING_LONGITUDE;

		Integer xOffset = 0, yOffset = 0;
		try {
			File fileOutput = new File( "Test_Grid_Global" + DISTANCE_BETWEEN_PLOTS_IN_METERS+"m.csv" );
			writer = new CSVWriter( new FileWriter( fileOutput  ) );

			String[] csvContents = null;
			double[] pointWithOffset = new double[]{ latitude, longitude};
			boolean firstPass;
			boolean moveToNextRow;
			Integer row = 0, column = 0;


			while( ( latitude > ENDING_LATITUDE ) ){
				firstPass = true;
				moveToNextRow = false;
				csvContents = new String[5];
				xOffset = 0;
				
				while( !moveToNextRow ){

					
					csvContents[0] = Integer.toString( row ) + "_" + Integer.toString( column );
					csvContents[1] = Double.toString(latitude);
					csvContents[2] = Double.toString(longitude);
					csvContents[3] = Integer.toString( yOffset );
					csvContents[4] = Integer.toString( xOffset );

					writer.writeNext(csvContents);

					pointWithOffset = CoordinateUtils.getPointWithOffset( new double[]{ latitude, longitude}, DISTANCE_BETWEEN_PLOTS_IN_METERS*-1, 0);
					longitude = pointWithOffset[1];
					xOffset += DISTANCE_BETWEEN_PLOTS_IN_METERS;
					
					if( firstPass ) {
						firstPass = !(longitude > STARTING_LONGITUDE);
					}
					moveToNextRow = !firstPass && (  STARTING_LONGITUDE > longitude ); 
					column ++;

				}

				row++;
				column = 0;
				yOffset += DISTANCE_BETWEEN_PLOTS_IN_METERS;
				pointWithOffset = CoordinateUtils.getPointWithOffset( new double[]{ latitude, STARTING_LONGITUDE},  0, DISTANCE_BETWEEN_PLOTS_IN_METERS*-1);
				longitude = STARTING_LONGITUDE;
				latitude = pointWithOffset[0];
			}

		}  catch (Exception e) {
			logger.error(" Error transforming the point coordinates ", e );
		} finally {
			try {
				if( writer != null )
					writer.close();
			} catch (IOException e) {
				logger.error("Error generating grid");
			}
		}

	}
}
