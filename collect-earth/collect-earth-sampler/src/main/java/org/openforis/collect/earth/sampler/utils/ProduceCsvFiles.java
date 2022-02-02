package org.openforis.collect.earth.sampler.utils;

import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Random;

import org.apache.commons.io.FilenameUtils;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.opencsv.CSVReader;
import com.opencsv.CSVWriter;
import com.opencsv.exceptions.CsvValidationException;

public class ProduceCsvFiles {

	private String[] headers;
	private Logger logger = LoggerFactory.getLogger( ProduceCsvFiles.class );
	private String sourceCsvFile;
	private boolean randomizeLines;
	private Integer divideByColumnIndex;
	private String destinationFolder;
	private File outputFolder;
	private Integer filesToDivideInto;
	private CollectSurvey survey;

	public ProduceCsvFiles(CollectSurvey survey, String sourceCsvFile, String destinationFolder, boolean randomizeLines, Integer divideByColumnIndex, Integer filesToDivideInto ) {
		super();
		this.survey = survey;
		this.sourceCsvFile = sourceCsvFile;
		this.destinationFolder = destinationFolder;
		this.randomizeLines = randomizeLines;
		this.divideByColumnIndex = divideByColumnIndex;
		this.filesToDivideInto = filesToDivideInto;
	}

	private void createOutputFolder() {
		outputFolder = new File(destinationFolder , "div_"+ filesToDivideInto);
		if( !outputFolder.exists() ){
			outputFolder.mkdir();
		}
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

		createOutputFolder();

		Map<String,List<String[]>> stringsPerStrata = new HashMap<>();

		try {
			processHeaders(fileToDivide);

			String originalFileName = FilenameUtils.getBaseName( fileToDivide.getName() );

			if( randomizeLines ){
				fileToDivide = randomizeFile( fileToDivide );
			}

			divideCsv(fileToDivide, stringsPerStrata, originalFileName);

		}catch (Exception e) {
			logger.error("Error processing CSV file 1", e);
		}

		return outputFolder;
	}

	private void divideCsv(File fileToDivide, Map<String, List<String[]>> stringsPerStrata, String originalFileName) {
		try ( CSVReader reader  = CsvReaderUtils.getCsvReader(fileToDivide.getPath(), true, getHeaders() != null ) ){


			// read first line
			String[] csvRow;

			// First divide the lines into the files by column ( or a single file if the user chose not to divide using a column)
			while ((csvRow = reader.readNext()) != null ) {

				String stratumColumnValue = originalFileName;
				if( divideByColumnIndex != null ){
					stratumColumnValue = csvRow[ divideByColumnIndex ];
				}

				List<String[]> rowsInStratum = stringsPerStrata.get( stratumColumnValue );
				if( rowsInStratum == null ){
					rowsInStratum = new ArrayList<>();
				}

				rowsInStratum.add( csvRow );

				stringsPerStrata.put(stratumColumnValue, rowsInStratum);
			}

			for (Iterator iterator = stringsPerStrata.entrySet().iterator(); iterator.hasNext();) {
				Entry<String, List<String[]>> rowsByFile = (Entry<String, List<String[]>>) iterator.next();
				divideIntoFile( rowsByFile.getKey(), rowsByFile.getValue() );
			}


		} catch (Exception e) {
			logger.error("Error processing CSV file 2", e);
		}
	}

	private void divideIntoFile(String strata, List<String[]> rows ) throws IOException {
		if( filesToDivideInto > 1 ) {

			int blockSize = rows.size() / filesToDivideInto;

			int fromIndex = 0;
			for( int i=1; i<=filesToDivideInto; i++) {
				String fileName = strata + "_" + i;
				int toIndex = fromIndex + blockSize;
				if( filesToDivideInto == i ) { // for the last one include all the remaning
					toIndex = rows.size();
				}

				List<String[]> rowsBlock = rows.subList(fromIndex, toIndex);
				writeStringsToCsv( fileName, rowsBlock);

				fromIndex = fromIndex + blockSize;
			}
		}else {
			writeStringsToCsv( strata, rows);
		}
	}

	private void processHeaders(File fileToDivide) throws IOException {

		String[] firstRow = null;
		// longitude has to be a number, otherwise it is a header
		try (
				CSVReader reader = CsvReaderUtils.getCsvReader(fileToDivide.getPath());
		){

			firstRow = reader.readNext();
			int numberOfIdColumns = getNumberOfIDColumns();
			Float.parseFloat( firstRow[ numberOfIdColumns+1 ]); // The first column after the ID column(s) should be a real number

		} catch (NumberFormatException | CsvValidationException e) {
			logger.warn("There are no numbers in the third row of the CSV file where the latitude should be" );
			setHeaders( firstRow);
		}
	}

	private void setHeaders(String[] csvRow) {
		headers = csvRow;
	}

	private String[] getHeaders(){
		return headers;
	}

	private File randomizeFile(File fileToDivide) throws IOException{

		List<String> lines = getAllLines(fileToDivide);

		List<String> linesWithoutFirst =  null;
		String firstLine = lines.get(0);

		if(lines.size() > 1 ){
			// Keep the first line in the first row (in case the first row contains header)
			List<String> linesWithoutFirstTemp = lines.subList(1, lines.size() );
			linesWithoutFirst = new ArrayList<>(linesWithoutFirstTemp);
			linesWithoutFirstTemp.clear();

			// Choose a random one from the list
			Random rnd = new SecureRandom();
			Collections.shuffle( linesWithoutFirst, rnd);
		}

		return writeLinesToFile( firstLine, linesWithoutFirst);
	}

	private File writeLinesToFile(String firstLine, List<String> lines) throws IOException {
		File randomizedFile = File.createTempFile("randomizeLines", "txt");

		try (
			BufferedOutputStream writer = new BufferedOutputStream( new FileOutputStream(randomizedFile ) )
		){
			Charset utfCharset = StandardCharsets.UTF_8;

			// Write the possible header
			writer.write( (firstLine + "\r\n").getBytes( utfCharset));

			if( lines != null ){
				// Then append the next lines
				for(String line: lines) {
					line = line + "\r\n";
					writer.write( line.getBytes( utfCharset));
				}
			}
		}

		return randomizedFile;
	}


	private static List<String> getAllLines(File fileToDivide)
			throws IOException {
		// Read in the file into a list of strings
		try(
				final BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(fileToDivide), StandardCharsets.UTF_8 )); //$NON-NLS-1$
		){
			List<String> lines = new ArrayList<>();

			String line;
			while( (line = reader.readLine() )!= null ) {
				lines.add(line);
			}

			return lines;
		}
	}

	public void writeStringsToCsv( String fileName, List<String[]> rows) throws IOException {
		File fileOutput = new File( outputFolder, fileName + ".csv" );
		try(
				CSVWriter writer = new CSVWriter( new OutputStreamWriter( new FileOutputStream( fileOutput ), StandardCharsets.UTF_8 ) );
		){
			if( getHeaders() != null ){
				writer.writeNext(getHeaders());
			}

			for (String[] row : rows) {
				writer.writeNext(row);
			}
		}

	}

}
