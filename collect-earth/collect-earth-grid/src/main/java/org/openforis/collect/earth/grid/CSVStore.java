package org.openforis.collect.earth.grid;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Vector;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVWriter;

public class CSVStore extends AbstractStore{

	private CSVWriter[] writers;

	private Logger logger = LoggerFactory.getLogger(CSVStore.class);
	
	public void closeStore() {
		for (CSVWriter w : writers) {
			try {
				w.close();
			} catch (IOException e) {
				logger.error("error closing the file", e);
			}			
		}
	}

	public void initializeStore( int distanceBetweenPlots ) {
		initializeStore( distanceBetweenPlots, "global" );
	}
	
	public void initializeStore( int distanceBetweenPlots, String prefix ) {

		Vector<String> headers = new Vector<String>();
		headers.add("CE_ID");
		headers.add("yCoordinate");
		headers.add("xCoordinate");

		for (Integer d : getDistances()) {
			headers.add("grid_" + d + "_"+ prefix);
		}

		File outputDir = new File( "output" );
		if( !outputDir.isDirectory() )
			outputDir.mkdir();
		
		String[] headerArray =  new String[headers.size()];
		headers.toArray(headerArray);

		writers = new CSVWriter[ getDistances().length ];
		CSVWriter w;

		try {
			int i=0;
			for (Integer d : getDistances()) {
				File fileOutput = new File(outputDir,  "Grid_"+ prefix +"_" + distanceBetweenPlots+ "m_"+ d +"_subgrid.csv" );
				System.out.println( fileOutput.getAbsolutePath() );
				w =  new CSVWriter( new FileWriter( fileOutput  ) );
				w.writeNext( headerArray );
				writers[i++] = w;

			}
		} catch (IOException e) {
			logger.error("Error writing to CSV", e);
		}
	}

	public void savePlot( Double latitude, Double longitude, Integer row, Integer column ) {


		String[] csvContents  = new String[ 5 + getDistances().length ];
		csvContents[0] = Integer.toString( row ) + "_" + Integer.toString( column );
		csvContents[1] = Double.toString(latitude);
		csvContents[2] = Double.toString(longitude);

		int i =0;
		Boolean[] grids = new Boolean[ getDistances().length ];
		for (Integer d : getDistances()) {
			Boolean grid = (column%d + row%d == 0);
			csvContents[ 3+i ] = grid.toString();
			grids[i] = grid;
			i++;
		}

		for (int j = 0; j < grids.length; j++) {
			if( grids[j] )
				writers[j].writeNext( csvContents );
		}


	}
}
