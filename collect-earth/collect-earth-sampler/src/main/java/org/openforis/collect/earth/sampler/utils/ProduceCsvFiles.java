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
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;
import au.com.bytecode.opencsv.CSVWriter;


public class ProduceCsvFiles {

	private String[] headers;
	private Logger logger = LoggerFactory.getLogger( ProduceCsvFiles.class );
	private String sourceCsvFile;
	private boolean randomizeLines;
	private Integer randomizeUsingColumnValues;
	private String destinationFolder;
	private File outputFolder;
	private Integer filesToDivideInto;
	private CollectSurvey survey;

	public ProduceCsvFiles(CollectSurvey survey, String sourceCsvFile, String destinationFolder, boolean randomizeLines, Integer randomizeUsingColumnValues, Integer filesToDivideInto ) {
		super();
		this.survey = survey;
		this.sourceCsvFile = sourceCsvFile;
		this.destinationFolder = destinationFolder;
		this.randomizeLines = randomizeLines;
		this.randomizeUsingColumnValues = randomizeUsingColumnValues;
		this.filesToDivideInto = filesToDivideInto;
		
	}

	private void createOutputFolder( Integer numberOfFiles) {
		outputFolder = new File(destinationFolder , "div_"+ filesToDivideInto);
		if( !outputFolder.exists() ){
			outputFolder.mkdir();
		}
		System.out.println(outputFolder.getAbsolutePath());
	}

	private int getNumberOfIDColumns(){
		if(survey!=null){
			List<AttributeDefinition> keyAttributeDefinitions = survey.getSchema().getRootEntityDefinitions().get(0).getKeyAttributeDefinitions();
			return keyAttributeDefinitions.size();
		}else{
			// Assume an standard survey with just one ID column
			return 1;
		}
	}
	
	public File divideIntoFiles() {
		
		File fileToDivide = new File(sourceCsvFile);
		if( !fileToDivide.exists() ){
			throw new IllegalArgumentException("The file selected " + sourceCsvFile + " does not exist");
		}
		
		createOutputFolder(filesToDivideInto);

		Map<Strata,CSVWriter> csvFiles = new HashMap<Strata, CSVWriter>();
		Map<String,Integer> linesPerStrata = new HashMap<String, Integer>(); 

		try {
			
			processHeaders(fileToDivide);
			
			String originalFileName = fileToDivide.getName();
			
			// If there is no division by column and the order should be randomized then randomize the file contents from the beginning
			if( randomizeUsingColumnValues == null && randomizeLines ){
				fileToDivide = randomizeFile( fileToDivide );
			}


			CSVReader reader = CsvReaderUtils.getCsvReader(fileToDivide.getPath());
			String[] csvRow;
			int rowNumber = 0;
			
			int numberOfIdColumns = getNumberOfIDColumns();
			while ((csvRow = reader.readNext()) != null ) {
				
				// latitude has to be a number, otherwise it is a header
				try {
					Float.parseFloat( csvRow[ numberOfIdColumns +1]); // The first column after the ID column(s) should be a real number
					
				} catch (NumberFormatException e) {
					// Not a number, we need to skip this row
					rowNumber++;
					continue;
				}
			
				Integer fileNumber = rowNumber % filesToDivideInto;
				
				String stratumColumnValue = originalFileName;
				if( randomizeUsingColumnValues != null ){
					stratumColumnValue = csvRow[ randomizeUsingColumnValues ];
					Integer lines = linesPerStrata.get( stratumColumnValue );
					if( lines == null ){
						lines = 1;
					}else{
						lines++;
					}
					
					// Adjust the fileNumber in relation to how many lines there are per strata so that the sub-files have equal sizes!
					fileNumber = lines % filesToDivideInto;
				
					linesPerStrata.put(stratumColumnValue, lines);
				}
				
				if( fileNumber == 0 && filesToDivideInto == 1){
					fileNumber = null;
				}
				
				Strata stratum = new Strata(stratumColumnValue, fileNumber);
				writCsvRow(csvFiles, csvRow, stratum);
				rowNumber++;
				
			}
		} catch (Exception e) {
			logger.error("Error processing CSV file", e);
		}finally{
			closeAllWriters( csvFiles );
		}

		// If there is no division by column and the order should be randomized then randomize the file contents from the beginning
		if( randomizeUsingColumnValues != null && randomizeLines ){
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
					logger.error( "Error while copying files", e);
				}
			}

		}
		
		
		return outputFolder;

	}

	private void processHeaders(File fileToDivide) throws IOException {
		CSVReader reader = CsvReaderUtils.getCsvReader(fileToDivide.getPath());
		String[] firstRow = null;
		// longitude has to be a number, otherwise it is a header
		try {
			
			firstRow = reader.readNext();
			int numberOfIdColumns = getNumberOfIDColumns();
			Float.parseFloat( firstRow[ numberOfIdColumns+1 ]); // The first column after the ID column(s) should be a real number
			
		} catch (NumberFormatException e) {
			logger.warn("There are no numbers in the third row of the CSV file where the latitude should be" );
			setHeaders( firstRow);
		}finally{
			reader.close();
		}
	}

	private void setHeaders(String[] csvRow) {
		headers = csvRow;
	}
	
	private String[] getHeaders(){
		return headers;
	}

	private File randomizeFile(File fileToDivide) throws Exception {
		
		
		List<String> lines = getAllLines(fileToDivide);

		List<String> linesWithoutFirst =  null;
		String firstLine = lines.get(0);
		
		if(lines.size() > 1 ){
			// Keep the first line in the first row (in case the first row contains header)
			List<String> linesWithoutFirstTemp = lines.subList(1, lines.size() );
			linesWithoutFirst = new ArrayList<String>(linesWithoutFirstTemp);
			linesWithoutFirstTemp.clear();
			
			// Choose a random one from the list
			Random rnd = new Random( 8230809358934589l );		
			Collections.shuffle( linesWithoutFirst, rnd);
		}
		
		File randomizedFile = writeLinesToFile( firstLine, linesWithoutFirst);

		return randomizedFile;
	}

	private File writeLinesToFile(String firstLine, List<String> lines) throws IOException {
		File randomizedFile = File.createTempFile("randomizeLines", "txt");
		BufferedOutputStream writer = new BufferedOutputStream( new FileOutputStream(randomizedFile ) );
		Charset utfCharset = Charset.forName("UTF-8");
		
		// Write the possible header
		writer.write( (firstLine + "\r\n").getBytes( utfCharset));
		
		if( lines != null ){
			// Then append the next lines
			for(String line: lines) {
				line = line + "\r\n";
				writer.write( line.getBytes( utfCharset));
			}
		}
		writer.close();
		return randomizedFile;
	}

	
	private List<String> getAllLines(File fileToDivide)
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
			
			if( getHeaders() != null ){
				writer.writeNext(getHeaders());
			}
			
		}
		writer.writeNext(csvRow);
	}

	private void closeAllWriters(Map<Strata, CSVWriter> csvFiles) {

		Set<Entry<Strata, CSVWriter>> writers = csvFiles.entrySet();
		for (Entry<Strata, CSVWriter> fileWriter : writers) {
			try {
				fileWriter.getValue().close();
			} catch (IOException e) {
				logger.error("Error closing writer", e);
			}
		}
	}
}
