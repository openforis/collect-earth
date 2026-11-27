package org.openforis.collect.earth.ipcc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestTypeEnum;
import org.openforis.collect.earth.ipcc.model.GrasslandSubdivision;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;

/**
 * The land use matrix of the IPCC export, written with POI as an .xls and read back: one sheet a year, the stratum's
 * climate, soil and ecozone, then the subdivisions as rows and columns with the areas that went from one to the other.
 */
public class IPCCDataExportMatrixExtendedExcelTest {

	@Test
	public void writesOneSheetAYearWithTheAreasBetweenTheSubdivisions() throws Exception {
		ForestSubdivision forest = new ForestSubdivision("FP", "Pine plantation", ManagementTypeEnum.MANAGED, 1, ForestTypeEnum.PINUS);
		GrasslandSubdivision grass = new GrasslandSubdivision("GR", "Grassland", ManagementTypeEnum.UNMANAGED, 2);
		List<LUSubdivisionDataPerYear> transitions = new ArrayList<>();
		transitions.add(new LUSubdivisionDataPerYear(forest, forest, 120.5));
		transitions.add(new LUSubdivisionDataPerYear(forest, grass, 7.25));
		transitions.add(new LUSubdivisionDataPerYear(grass, grass, 300));
		StratumPerYearData stratum = new StratumPerYearData(2020, "Tropical wet", "High activity clay", "Tropical rainforest");
		stratum.setLuData(transitions);

		File xls = new IPCCDataExportMatrixExtendedExcel().generateFile(List.of(stratum));

		assertTrue(xls.length() > 0);
		try (InputStream in = Files.newInputStream(xls.toPath()); Workbook workbook = new HSSFWorkbook(in)) {
			assertEquals(1, workbook.getNumberOfSheets());
			Sheet sheet = workbook.getSheetAt(0);
			assertEquals("LU Matrix 2020-2021", sheet.getSheetName());
			StringBuilder text = new StringBuilder();
			double total = 0;
			for (Row row : sheet) {
				row.forEach(cell -> {
					switch (cell.getCellType()) {
					case STRING:
						text.append(cell.getStringCellValue()).append('|');
						break;
					default:
						break;
					}
				});
				for (int c = 0; c < row.getLastCellNum(); c++) {
					if (row.getCell(c) != null && row.getCell(c).getCellType() == org.apache.poi.ss.usermodel.CellType.NUMERIC) {
						total += row.getCell(c).getNumericCellValue();
					}
				}
			}
			for (String expected : new String[] { "Tropical wet", "High activity clay", "Tropical rainforest", "Transition 2020/2021" }) {
				assertTrue(text.toString().contains(expected), expected + " in " + text);
			}
			// Every area of the matrix, each once
			assertEquals(120.5 + 7.25 + 300, total, 1e-9);
		}
	}
}
