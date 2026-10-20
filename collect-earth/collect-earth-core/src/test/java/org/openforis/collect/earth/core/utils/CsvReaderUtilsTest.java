package org.openforis.collect.earth.core.utils;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CsvReaderUtilsTest {

	@TempDir
	Path tempDir;

	private String writeFile(String name, String content) throws IOException {
		Path file = tempDir.resolve(name);
		Files.write(file, content.getBytes(StandardCharsets.UTF_8));
		return file.toString();
	}

	// Same shape as the file that the "Remove plots from DB" tool rejected : only the two key columns of the survey
	@Test
	void plotKeysFileWithTwoColumnsIsCsvWhenTwoColumnsAreExpected() throws IOException {
		String keysFile = writeFile("keys.csv", "id,round\n0,1\n1,1\n2,1\n");

		assertTrue(CsvReaderUtils.isCsvFile(keysFile, 2));
	}

	@Test
	void plotKeysFileWithTwoColumnsIsNotAPlotFile() throws IOException {
		String keysFile = writeFile("keys.csv", "id,round\n0,1\n1,1\n2,1\n");

		// A plot file still needs ID, latitude and longitude
		assertFalse(CsvReaderUtils.isCsvFile(keysFile));
	}

	@Test
	void plotKeysFileWithOneColumnIsCsvWhenOneColumnIsExpected() throws IOException {
		String keysFile = writeFile("keys.csv", "id\n0\n1\n2\n");

		assertTrue(CsvReaderUtils.isCsvFile(keysFile, 1));
	}

	@Test
	void plotKeysFileWithSemicolonsIsCsv() throws IOException {
		String keysFile = writeFile("keys.csv", "id;round\n0;1\n1;1\n");

		assertTrue(CsvReaderUtils.isCsvFile(keysFile, 2));
	}

	@Test
	void leadingEmptyLinesAreSkipped() throws IOException {
		String keysFile = writeFile("keys.csv", "\n\nid,round\n0,1\n");

		assertTrue(CsvReaderUtils.isCsvFile(keysFile, 2));
	}

	@Test
	void plotFileIsCsv() throws IOException {
		String plotFile = writeFile("plots.csv", "id,YCoordinate,XCoordinate\n1,12.5,-3.2\n");

		assertTrue(CsvReaderUtils.isCsvFile(plotFile));
	}

	@Test
	void textWithoutSeparatorsIsNotCsv() throws IOException {
		String textFile = writeFile("notes.csv", "This is just some text\nand some more text\n");

		assertFalse(CsvReaderUtils.isCsvFile(textFile, 2));
	}

	@Test
	void emptyFileIsNotCsv() throws IOException {
		String emptyFile = writeFile("empty.csv", "\n\n");

		assertFalse(CsvReaderUtils.isCsvFile(emptyFile, 2));
	}
}
