package org.openforis.collect.earth.grid;

import java.io.BufferedOutputStream;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
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
		// Guarded : the store is closed in a finally block, so it is reached even when opening the files failed
		if( writers == null ) {
			return;
		}
		for (CSVWriter w : writers) {
			if( w == null ) {
				continue;
			}
			try {
				// CSVWriter keeps its write failures to itself, a full disk is only visible through checkError()
				if( w.checkError() ) {
					logger.error("The CSV file could not be written completely");
				}
				w.close();
			} catch (IOException e) {
				logger.error("error closing the file", e);
			}
		}
		writers = null;
	}

	public void initializeStore( int distanceBetweenPlots, boolean zipOutput ) throws IOException {
		initializeStore( distanceBetweenPlots, "global", zipOutput );
	}

	@Override
	public void initializeStore(int distanceBetweenPlots) throws Exception {
		initializeStore( distanceBetweenPlots, false );
	}

	public void initializeStore( int distanceBetweenPlots, String prefix, boolean zipOutput ) throws IOException {

		Vector<String> headers = new Vector<String>();
		headers.add("CE_ID");
		headers.add("yCoordinate");
		headers.add("xCoordinate");

		for (Integer d : getDistances()) {
			headers.add("grid_" + d + "_"+ prefix);
		}

		File outputDir = new File( "output" );
		if( !outputDir.isDirectory() && !outputDir.mkdirs() ) {
			// Checked : when the directory could not be created every file below failed one by one instead
			throw new IOException( "The output directory could not be created : " + outputDir.getAbsolutePath() );
		}

		headerArray =  new String[headers.size()];
		headers.toArray(headerArray);

		writers = new CSVWriter[ getDistances().length ];
		namePrefix = new String[ getDistances().length ];
		zosForWriterOutputStreams = new ZipOutputStream[ getDistances().length ];
		rowCounters = new Integer[ getDistances().length ];

		CSVWriter w;

		// The failure reaches the caller : it used to be logged and the writers left null, so the first plot saved died on a
		// NullPointerException instead
		int i=0;
		for (Integer d : getDistances()) {
			File fileOutput = new File(outputDir,  prefix +"_" + distanceBetweenPlots+ "m_"+ d +"_subgrid.csv" + ( zipOutput?".zip":"" ) );
			logger.info( fileOutput.getAbsolutePath() );

			Writer writer;
			if( zipOutput ) {
				// Only one of the two : the plain FileWriter was opened in both cases, and when zipping it was left open on a
				// file that the stream below then truncated
				FileOutputStream fos =  new FileOutputStream( fileOutput );
				BufferedOutputStream bos = new BufferedOutputStream(fos);
				ZipOutputStream zos = new ZipOutputStream(bos);
				namePrefix[i] = prefix +"_" + distanceBetweenPlots+ "m_"+ d;
				zos.putNextEntry( new ZipEntry( namePrefix[i] +"_subgrid_0.csv" ) );
				zosForWriterOutputStreams[i] = zos;
				writer = new OutputStreamWriter( zos, StandardCharsets.UTF_8 );
			} else {
				writer = new BufferedWriter( new OutputStreamWriter( new FileOutputStream( fileOutput ), StandardCharsets.UTF_8 ) );
			}

			w =  new CSVWriter(  writer );
			w.writeNext( headerArray );

			writers[i] = w;
			rowCounters[i] = 0;

			i++;

		}
	}

	public void savePlot( Double latitude, Double longitude, Integer row, Integer column ) {


		// As wide as the header : it was two longer, so every row ended with two empty columns that no header named
		String[] csvContents  = new String[ 3 + getDistances().length ];
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
