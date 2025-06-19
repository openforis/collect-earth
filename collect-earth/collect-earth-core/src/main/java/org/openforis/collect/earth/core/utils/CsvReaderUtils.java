package org.openforis.collect.earth.core.utils;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.opencsv.CSVParser;
import com.opencsv.CSVParserBuilder;
import com.opencsv.CSVReader;
import com.opencsv.CSVReaderBuilder;
import com.opencsv.exceptions.CsvValidationException;

public class CsvReaderUtils {
	private static final Logger logger = LoggerFactory.getLogger(CsvReaderUtils.class);

	private CsvReaderUtils() {

	}

	public static boolean isCsvFile(String csvFile) throws IOException {
		boolean isCsvFile = true;
		try {
			getCsvReader(csvFile, false);
		} catch (IllegalArgumentException e) {
			// The CSV reader could not read the file, thus it is not a CSVReader
			isCsvFile = false;
		}

		return isCsvFile;
	}

	public static CSVReader getCsvReader(String csvFile) throws IOException {
		return getCsvReader(csvFile, true);
	}

	public static CSVReader getCsvReader(String csvFile, boolean checkContainsCoordinates) throws IOException {
		return getCsvReader(csvFile, checkContainsCoordinates, false);
	}

	public static CSVReader getCsvReader(String csvFile, boolean checkContainsCoordinates, boolean skipHeader)
			throws IOException {

		char[] possibleSeparators = new char[] { ',', ';', '\t', '|' };
		CSVReader csvReader = null;
		for (char c : possibleSeparators) {
			CSVReader commaSeparatedReader = getCsvReader(csvFile, c, skipHeader);
                       if (!checkContainsCoordinates) {
                               return commaSeparatedReader;
                       } else if (checkCsvReaderWorks(commaSeparatedReader)) {
                               commaSeparatedReader.close();
                               csvReader = getCsvReader(csvFile, c, skipHeader); // Get the reader again so that it starts from the
                                                                               // first column
                               break;
                       } else {
                               commaSeparatedReader.close();
                       }
		}

		if (csvReader == null) {
			throw new IllegalArgumentException(
					"The CSV plot file does not seem to contain actual comma separated values! " + csvFile);
		} else {
			return csvReader;
		}
	}

	public static boolean onlyEmptyCells(String[] csvRow) {
		for (String csvColumn : csvRow) {
			if (csvColumn.trim().length() > 0) {
				return false;
			}
		}
		return true;
	}

	private static boolean checkCsvReaderWorks(CSVReader csvReader) throws IOException {

		String[] csvRow = null;

		try {
			while ((csvRow = csvReader.readNext()) != null) {
				if (csvRow.length == 1 && csvRow[0].trim().length() == 0) {
					// This would be an empty line
					continue;
				} else if (csvRow.length == 1 && csvRow[0].trim().length() > 0) {

					return false;
				} else if (csvRow.length < 3) {
					return false;
				} else {
					return true;
				}
			}
		} catch (CsvValidationException | IOException e) {
			logger.error("error getting the line in the CSV", e);
		}

		// If the script reaches this point it means that all the lines in the CSV file
		// were empty!
		throw new IllegalArgumentException("The CSV plot file has no data! All the lines are empty!");
	}

	private static CSVReader getCsvReader(String csvFile, char columnSeparator, boolean skipHeader) throws IOException {
		int skipLines = skipHeader ? 1 : 0;

		CSVParser parser = new CSVParserBuilder().withSeparator(columnSeparator).build();
		BufferedReader br = new BufferedReader(
				new InputStreamReader(new FileInputStream(csvFile), StandardCharsets.UTF_8));
		CSVReader reader = new CSVReaderBuilder(br).withCSVParser(parser).build();
		if (skipLines > 0) {
			reader.skip(skipLines);
		}
		return reader;
	}
}
