package org.openforis.collect.earth.sampler.transformer;

import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.HashMap;



import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;
import au.com.bytecode.opencsv.CSVWriter;

public class GetFusionCsv {

	/**
	 * @param args
	 */
	public static void main(String[] args) {
		final GetFusionCsv fusionCsv = new GetFusionCsv();
		try {
			fusionCsv.processFile();
		} catch (final IOException e) {
			LoggerFactory.getLogger(GetFusionCsv.class);
		}

	}

	HashMap<String, Integer> classesById = new HashMap<String, Integer>();

	private int getId(String landUse) {
		if (classesById.get(landUse) != null) {
			return classesById.get(landUse);
		} else {
			final int key = classesById.size() + 1;
			classesById.put(landUse, key);
			return key;
		}
	}

	private void processFile() throws IOException {
		final CSVReader csvReader = new CSVReader(new FileReader(new File("ullaan.csv")), ';');
		final CSVWriter csvWriter = new CSVWriter(new FileWriter(new File("resultFusion.csv")), ';');
		String[] nextRow;
		final String[] writeRow = new String[4];
		writeRow[0] = "Coordinates";
		writeRow[1] = "Land Use ID";
		writeRow[2] = "Land Use name";
		writeRow[3] = "Placemark ID";
		csvWriter.writeNext(writeRow);
		while ((nextRow = csvReader.readNext()) != null) {

			writeRow[0] = "<Point><coordinates>" + replaceComma(nextRow[2]) + "," + replaceComma(nextRow[3]) + ",0.0</coordinates></Point>";
			final String landUse = nextRow[5];
			final int classId = getId(landUse);
			writeRow[1] = classId + "";
			writeRow[2] = landUse;
			writeRow[3] = nextRow[0];
			csvWriter.writeNext(writeRow);
		}
		csvWriter.close();
		csvReader.close();
	}

	private String replaceComma(String location) {
		return location.replace(',', '.');
	}

}
