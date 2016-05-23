package org.openforis.collect.earth.sampler.utils;

import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Random;
import java.util.Set;

import org.apache.commons.io.FileUtils;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;

import au.com.bytecode.opencsv.CSVReader;
import au.com.bytecode.opencsv.CSVWriter;


public class ProduceCsvFiles {

	public static void main(String[] args) {

		ProduceCsvFiles producer = new ProduceCsvFiles("mongolia_training_random");
		File fileToDivide = new File("Mongolia_10000_qc_eco.csv");

		//producer.divideRandomlyByColumn(fileToDivide, 10, 9);
		producer.divideRandomly(fileToDivide, 22);

		System.exit(0);
	}

	File outputFolder;
	String outputFolderName;


	public ProduceCsvFiles(String outputFolderName) {
		super();
		this.outputFolderName = outputFolderName;
	}

	public void createOutputFolder( Integer numberOfFiles) {
		outputFolder = new File(outputFolderName + "_div_"+ numberOfFiles);
		if( !outputFolder.exists() ){
			outputFolder.mkdir();
		}
	}

	private void divideByColumn(File fileToDivide, int numberOfFiles, Integer dividideByValueInColumn ){
		divideIntoFiles(fileToDivide, numberOfFiles, false, dividideByValueInColumn);
	}

	private void divideRandomly(File fileToDivide, int numberOfFiles){
		divideIntoFiles(fileToDivide, numberOfFiles, true, null);
	}

	private void divideRandomlyByColumn(File fileToDivide, int numberOfFiles, Integer dividideByValueInColumn ){
		divideIntoFiles(fileToDivide, numberOfFiles, true, dividideByValueInColumn);
	}

	private void divideIntoFiles( File fileToDivide, int numberOfFiles, boolean randomize, Integer dividideByValueInColumn ) {

		createOutputFolder(numberOfFiles);

		Map<Strata,CSVWriter> csvFiles = new HashMap<Strata, CSVWriter>();

		try {
			// If there is no division by column and the order should be randomized then randomize the file contents from the beginning
			if( dividideByValueInColumn == null && randomize ){
				fileToDivide = randomizeFile( fileToDivide );
			}

			CSVReader reader = CsvReaderUtils.getCsvReader(fileToDivide.getPath());


			String[] csvRow;
			int rowNumber = 0;
			while ((csvRow = reader.readNext()) != null ) {
				
				// longitude has to be a number, otherwise it is a header
				try {
					Float.parseFloat( csvRow[2]);
				} catch (NumberFormatException e) {
					// Not a number, we need to skip this row
					rowNumber++;
					continue;
				}
			

				String stratumColumnValue = "Mongolia";
				if( dividideByValueInColumn != null ){
					stratumColumnValue = csvRow[ dividideByValueInColumn ];
				}

				Integer fileNumber = rowNumber % numberOfFiles;
				Strata stratum = new Strata(stratumColumnValue, fileNumber);

				writCsvRow(csvFiles, csvRow, stratum);

				rowNumber++;
			}

		} catch (Exception e) {
			e.printStackTrace();
		}finally{
			closeAllWriters( csvFiles );
		}

		// If there is no division by column and the order should be randomized then randomize the file contents from the beginning
		if( dividideByValueInColumn != null && randomize ){
			Set<Strata> keySet = csvFiles.keySet();
			File randomizedOutput = new File( outputFolder, "randomized");
			if( randomizedOutput.exists() ){
				randomizedOutput.mkdir();
			}

			for (Strata strata : keySet) {
				try {
					File outputRandom = randomizeFile( strata.getOutputFile() );
					File copyToFile = new File( randomizedOutput, strata.getFileName());

					FileUtils.copyFile(outputRandom, copyToFile);
				} catch (Exception e) {
					// TODO Auto-generated catch block
					e.printStackTrace();
				}
			}

		}

	}

	private File randomizeFile(File fileToDivide) throws Exception {
		List<String> lines = getAllLines(fileToDivide);

		// Choose a random one from the list
		Random rnd = new Random( 8230809358934589l );		
		Collections.shuffle( lines, rnd);

		File randomizedFile = writeLinesToFile(lines);

		return randomizedFile;
	}

	public File writeLinesToFile(List<String> lines) throws IOException {
		File randomizedFile = File.createTempFile("randomizeLines", "txt");
		BufferedOutputStream writer = new BufferedOutputStream( new FileOutputStream(randomizedFile ) );
		Charset utfCharset = Charset.forName("UTF-8");
		for(String line: lines) {
			line = line + "\r\n";
			writer.write( line.getBytes( utfCharset));
		}
		writer.close();
		return randomizedFile;
	}

	
	
/*	public File writeLinesToFile(List<String> lines) throws IOException {
		File randomizedFile = File.createTempFile("randomizeLines", "txt");
		FileWriter writer = new FileWriter( randomizedFile ); 
		for(String line: lines) {
			writer.write( line + "\r\n");
		}
		writer.close();
		return randomizedFile;
	}*/
	
	public List<String> getAllLines(File fileToDivide)
			throws FileNotFoundException, IOException {
		// Read in the file into a list of strings
		final BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(fileToDivide), Charset.forName("UTF-8"))); //$NON-NLS-1$
		List<String> lines = new ArrayList<String>();

		String line;
		while( (line = reader.readLine() )!= null ) {
			lines.add(line);
		}
		reader.close();
		return lines;
	}

	private void writCsvRow(Map<Strata, CSVWriter> csvFiles, String[] csvRow,
			Strata toStrataFile) throws IOException {
		CSVWriter writer = csvFiles.get( toStrataFile );
		if( writer == null ){
			String fileName = toStrataFile.getFileName();
			File fileOutput = new File( outputFolder, fileName );
			toStrataFile.setOutputFile(fileOutput);
			writer = new CSVWriter( new FileWriter( fileOutput  ) );
			csvFiles.put(toStrataFile, writer );
		}
		writer.writeNext(csvRow);
	}

	private void closeAllWriters(Map<Strata, CSVWriter> csvFiles) {

		Set<Entry<Strata, CSVWriter>> writers = csvFiles.entrySet();
		for (Entry<Strata, CSVWriter> fileWriter : writers) {
			try {
				fileWriter.getValue().close();
			} catch (IOException e) {
				// TODO Auto-generated catch block
				e.printStackTrace();
			}
		}
	}

	private boolean isSquare(String coord, int degree) {
		float floatNum = Float.parseFloat( coord );
		int intNum = Math.round( floatNum * 100f );
		return (intNum%degree)==0;

	}

}
