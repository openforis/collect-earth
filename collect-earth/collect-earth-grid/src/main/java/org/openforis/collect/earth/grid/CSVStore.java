package org.openforis.collect.earth.grid;

import java.io.BufferedOutputStream;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.util.Vector;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.opencsv.CSVWriter;

public class CSVStore extends AbstractStore{

	private CSVWriter[] writers;
	private Integer[] rowCounters;
	private ZipOutputStream[] zosForWriterOutputStreams;
	private String[] namePrefix;
	private String[] headerArray;

	private static final int FLUSH_ROWS = 250000;
	private static final int NEW_ENTRY_ROWS = 500000;

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

	public void initializeStore( int distanceBetweenPlots, boolean zipOutput ) {
		initializeStore( distanceBetweenPlots, "global", zipOutput );
	}

	@Override
	public void initializeStore(int distanceBetweenPlots) throws Exception {
		initializeStore( distanceBetweenPlots, false );
	}

	public void initializeStore( int distanceBetweenPlots, String prefix, boolean zipOutput ) {

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

		headerArray =  new String[headers.size()];
		headers.toArray(headerArray);

		writers = new CSVWriter[ getDistances().length ];
		namePrefix = new String[ getDistances().length ];
		zosForWriterOutputStreams = new ZipOutputStream[ getDistances().length ];
		rowCounters = new Integer[ getDistances().length ];

		CSVWriter w;

		try {
			int i=0;
			for (Integer d : getDistances()) {
				File fileOutput = new File(outputDir,  prefix +"_" + distanceBetweenPlots+ "m_"+ d +"_subgrid.csv" + ( zipOutput?".zip":"" ) );
				logger.info( fileOutput.getAbsolutePath() );

				Writer writer;
				FileWriter file = new FileWriter( fileOutput );
				writer = new BufferedWriter(file);
				if( zipOutput ) {
					FileOutputStream fos =  new FileOutputStream( fileOutput );
					BufferedOutputStream bos = new BufferedOutputStream(fos);
					ZipOutputStream zos = new ZipOutputStream(bos);
					namePrefix[i] = prefix +"_" + distanceBetweenPlots+ "m_"+ d;
					zos.putNextEntry( new ZipEntry( namePrefix[i] +"_subgrid_0.csv" ) );
					zosForWriterOutputStreams[i] = zos;
					writer = new OutputStreamWriter( zos );
				}

				w =  new CSVWriter(  writer );
				w.writeNext( headerArray );

				writers[i] = w;
				rowCounters[i] = 0;

				i++;

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
			if( grids[j] ) {
				writers[j].writeNext( csvContents );
				rowCounters[j] = rowCounters[j] + 1;
				if( rowCounters[j] % FLUSH_ROWS == 0 ) {
					logger.info( "Flushing! " + rowCounters[j] );
					try {
						writers[j].flush();
					} catch (IOException e) {
						logger.error("Error flushing rows!!", e);
					}
				}

				if( rowCounters[j] % NEW_ENTRY_ROWS == 0 ) {

					try {
						writers[j].flush();

						if( zosForWriterOutputStreams[j] != null ) {
							int fileIndex = Math.abs( rowCounters[j] / NEW_ENTRY_ROWS );

							String newFileName = namePrefix[j] +"_subgrid_" + fileIndex + ".csv";
							logger.info( "New Zip file! " + newFileName );
							zosForWriterOutputStreams[j].putNextEntry( new ZipEntry( newFileName ) );

							writers[j].writeNext( headerArray );
						}

					} catch (IOException e) {
						logger.error("Error flushing rows!!", e);
					}
				}


			}
		}


	}


}
