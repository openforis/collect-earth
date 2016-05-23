package org.openforis.collect.earth.sampler.utils;

public class CsvReader {

	public CsvReader() {
		super();
	}

	protected CSVReader getCsvReader(String csvFile) throws FileNotFoundException {
		CSVReader reader;
		final BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile), Charset.forName("UTF-8")));
		reader = new CSVReader(bufferedReader, ',');
		return reader;
	}

}