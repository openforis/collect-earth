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

	// A plot file has at least the ID, the latitude and the longitude
	private static final int PLOT_FILE_MINIMUM_COLUMNS = 3;

	private CsvReaderUtils() {

	}

	/**
	 * Checks that the file is a plot CSV : values separated by one of the known separators, with at least ID, latitude and longitude.
	 */
	public static boolean isCsvFile(String csvFile) throws IOException {
		return isCsvFile(csvFile, PLOT_FILE_MINIMUM_COLUMNS);
	}

	/**
	 * Checks that the file is a CSV whose first line with data has at least <code>minimumColumns</code> values.
	 * Files that are not plot files, like the list of plot keys used to remove plots, can have fewer than the three columns of a plot file.
	 */
	public static boolean isCsvFile(String csvFile, int minimumColumns) throws IOException {
		// Ask for the check : without it the file was only opened, so every readable file passed as a CSV and the reader leaked
		try ( CSVReader reader = detectCsvReader(csvFile, minimumColumns, false) ) {
			return reader != null;
		} catch (IllegalArgumentException e) {
			// The CSV reader could not read the file, thus it is not a CSVReader
			return false;
		}
	}

	public static CSVReader getCsvReader(String csvFile) throws IOException {
		return getCsvReader(csvFile, true);
	}

	public static CSVReader getCsvReader(String csvFile, boolean checkContainsCoordinates) throws IOException {
		return getCsvReader(csvFile, checkContainsCoordinates, false);
	}

	public static CSVReader getCsvReader(String csvFile, boolean checkContainsCoordinates, boolean skipHeader)
			throws IOException {

		if (!checkContainsCoordinates) {
			return getCsvReader(csvFile, ',', skipHeader);
		}
		return detectCsvReader(csvFile, PLOT_FILE_MINIMUM_COLUMNS, skipHeader);
	}

	private static CSVReader detectCsvReader(String csvFile, int minimumColumns, boolean skipHeader) throws IOException {

		char[] possibleSeparators = new char[] { ',', ';', '\t', '|' };

		CSVReader csvReader = null;
		for (char c : possibleSeparators) {
			boolean separatorWorks;
			// Close the reader that was used for the test : the one that worked used to be left open
			try ( CSVReader testReader = getCsvReader(csvFile, c, skipHeader) ) {
				separatorWorks = checkCsvReaderWorks(testReader, minimumColumns);
			}
			if (separatorWorks) {
				csvReader = getCsvReader(csvFile, c, skipHeader); // Get the reader again so that it starts from the first column
				break;
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

	private static boolean checkCsvReaderWorks(CSVReader csvReader, int minimumColumns) throws IOException {

		String[] csvRow = null;

		try {
			while ((csvRow = csvReader.readNext()) != null) {
				if (csvRow.length == 1 && csvRow[0].trim().length() == 0) {
					// This would be an empty line
					continue;
				} else {
					// With the wrong separator the whole line comes back as a single value
					return csvRow.length >= minimumColumns;
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
