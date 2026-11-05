package org.openforis.collect.earth.ipcc;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

import org.apache.poi.ss.usermodel.Workbook;
import org.junit.jupiter.api.Test;

/**
 * The template of the sampling uncertainty workbook of the LULUCF package can be filled in and written: opened read
 * only on its file, POI refused to write it ("document open in read only mode"), and the package was made without it.
 * It is not kept locked either, so it can be opened again for the next package.
 */
class SamplingUncertaintyTemplateTest {

	@Test
	void theTemplateIsWrittenAndLeftFree() throws Exception {
		SamplingUncertaintyGenerator generator = new SamplingUncertaintyGenerator();
		ByteArrayOutputStream written = new ByteArrayOutputStream();
		try (Workbook workbook = generator.getSamplingUncertainityTemplate()) {
			assertNotNull(workbook, "the template is read");
			workbook.getSheetAt(0).createRow(workbook.getSheetAt(0).getLastRowNum() + 1).createCell(0).setCellValue("filled in");
			workbook.write(written);
		}
		assertTrue(written.size() > 0, "the workbook is written");

		// Nothing holds the template: it opens again, and on Windows a locked file could not be opened for writing
		File template = new File("resources/Uncertainty_Analysis_CollectEarth_Template.xlsx");
		try (OutputStream append = new FileOutputStream(template, true)) {
			// opened for appending and closed without writing: the template is unchanged
		}
		try (Workbook again = generator.getSamplingUncertainityTemplate()) {
			assertNotNull(again, "the template is read again");
		}
	}
}
