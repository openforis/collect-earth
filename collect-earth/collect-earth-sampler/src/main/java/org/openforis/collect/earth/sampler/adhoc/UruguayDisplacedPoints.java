package org.openforis.collect.earth.sampler.adhoc;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.utils.CoordinateUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.opencsv.CSVReader;
import com.opencsv.CSVWriter;

public class UruguayDisplacedPoints {


	public static void main(String[] args) {

		Logger logger = LoggerFactory.getLogger( UruguayDisplacedPoints.class );
		File fileToDivide = new File("C:/temp/urugua2.csv");
		if( !fileToDivide.exists() ){
			throw new IllegalArgumentException("The file selected does not exist");
		}

		CSVReader reader = null;
		try (
				FileWriter fw = new FileWriter( new File("C:/temp/modified2.csv")  );
				CSVWriter writer = new CSVWriter( fw );
		){

			List<String[]> modified = new ArrayList<>();

			// If there are headers skip the first line
			reader = CsvReaderUtils.getCsvReader(fileToDivide.getPath(), false, true );

			// read first line
			String[] csvRow;

			// First divide the lines into the files by column ( or a single file if the user chose not to divide using a column)
			while ((csvRow = reader.readNext()) != null ) {

				Double yCoordinate = Double.parseDouble( csvRow[1] );
				Double xCoordinate = Double.parseDouble( csvRow[2] );

				double[] pointWithOffset = CoordinateUtils.getPointWithOffset( new double[]{ yCoordinate, xCoordinate }, 1500, 1500);

				csvRow[1] = Double.toString( pointWithOffset[0] );
				csvRow[2] = Double.toString( pointWithOffset[1] );

				modified.add( csvRow );
			}

			for (String[] row : modified) {
				writer.writeNext(row);
			}

		} catch (Exception e) {
			logger.error("Error processing CSV file", e);
		}finally{

			if(reader!=null) {
				try {
					reader.close();
				} catch (IOException e) {
					logger.warn("Error closing CSV reader ");
				}
			}
		}

	}
}
