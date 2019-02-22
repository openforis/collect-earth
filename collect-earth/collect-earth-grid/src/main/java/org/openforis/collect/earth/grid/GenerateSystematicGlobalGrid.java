package org.openforis.collect.earth.grid;

import org.openforis.collect.earth.sampler.utils.CoordinateUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GenerateSystematicGlobalGrid{

	public static void main(String[] args)  {
		GenerateSystematicGlobalGrid globalGrid = new GenerateSystematicGlobalGrid();
		globalGrid.generate();

	}

	private static final Integer DISTANCE_BETWEEN_PLOTS_IN_METERS = 50000;

	private static final Double STARTING_LONGITUDE = -169d;

	private static final Double STARTING_LATITUDE = 85d;

	private static final Double ENDING_LATITUDE = -85d;

	private Logger logger = LoggerFactory.getLogger(this.getClass());

	private AbstractStore store = new JDBCStore();

	public void generate(){
		long startTime = System.currentTimeMillis();
		try {

			
			store.initializeStore( DISTANCE_BETWEEN_PLOTS_IN_METERS );

			Double latitude = STARTING_LATITUDE;
			Double longitude = STARTING_LONGITUDE;

			Integer xOffset = 0, yOffset = 0;

			double[] pointWithOffset = new double[]{ latitude, longitude};
			boolean firstPass;
			boolean moveToNextRow;
			Integer row = 0, column = 0;


			while( ( latitude > ENDING_LATITUDE ) ){
				firstPass = true;	
				moveToNextRow = false;
				xOffset = 0;

				while( !moveToNextRow ){
					store.savePlot( latitude, longitude, yOffset, xOffset, row,  column);

					pointWithOffset = CoordinateUtils.getPointWithOffset( new double[]{ latitude, longitude}, DISTANCE_BETWEEN_PLOTS_IN_METERS*-1, 0); // Move DISTANCE Westwards
					longitude = pointWithOffset[1];
					xOffset += DISTANCE_BETWEEN_PLOTS_IN_METERS;

					if( firstPass ) {
						firstPass = !(longitude > STARTING_LONGITUDE);
					}
					moveToNextRow = !firstPass && (  STARTING_LONGITUDE > longitude ); 
					column ++;
				}
				System.out.println( "Finished row - " + row);
				row++;
				column = 0;
				yOffset += DISTANCE_BETWEEN_PLOTS_IN_METERS;
				pointWithOffset = CoordinateUtils.getPointWithOffset( new double[]{ latitude, STARTING_LONGITUDE},  0, DISTANCE_BETWEEN_PLOTS_IN_METERS*-1); // Move DISTANCE Southwards
				longitude = STARTING_LONGITUDE;
				latitude = pointWithOffset[0];
			}

		}  catch (Exception e) {
			logger.error(" Error transforming the point coordinates ", e );
		} finally {
			System.out.println( "Total time millis " + (System.currentTimeMillis() - startTime ));
			store.closeStore();
		}

	}
}
