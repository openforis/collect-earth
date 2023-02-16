package org.openforis.collect.earth.ipcc;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.ipcc.model.LandUseSubdivision;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class IPCCDataExportMatrixExtendedExcel extends AbstractIPCCDataExportTimeSeries<StratumPerYearData> {

	Logger logger = LoggerFactory.getLogger(IPCCDataExportMatrixExtendedExcel.class);

	public IPCCDataExportMatrixExtendedExcel() {
		super();
		setExportTypeUsed(ExportType.IPCC);
	}

	@Override
	protected File generateFile(List<StratumPerYearData> strataData) throws IOException {
		File excelDestination = File.createTempFile("LuMatrixTimeseries_EXTENDED", ".xls");
		excelDestination.deleteOnExit();
		// Create a Workbook
		try(Workbook workbook = new HSSFWorkbook() ) {// new HSSFWorkbook() for generating `.xls` file
			
			/*
			 * CreationHelper helps us create instances of various things like DataFormat,
			 * Hyperlink, RichTextString etc, in a format (HSSF, XSSF) independent way
			 */
			// CreationHelper createHelper = workbook.getCreationHelper();

			// Create a Font for styling header cells
			Font cornerFont = workbook.createFont();
			cornerFont.setBold(true);
			cornerFont.setFontHeightInPoints((short) 15);
			cornerFont.setColor(IndexedColors.GREY_80_PERCENT.getIndex());
			// Create a CellStyle with the font
			CellStyle cornerCellStyle = workbook.createCellStyle();
			cornerCellStyle.setFont(cornerFont);

			// Create a Font for styling header cells
			Font headerFont = workbook.createFont();
			headerFont.setBold(true);
			headerFont.setFontHeightInPoints((short) 14);
			headerFont.setColor(IndexedColors.DARK_TEAL.getIndex());
			// Create a CellStyle with the font
			CellStyle headerCellStyle = workbook.createCellStyle();
			headerCellStyle.setFont(headerFont);

			// Create a Font for styling non-diagonal cells
			Font stdFont = workbook.createFont();
			stdFont.setBold(false);
			stdFont.setFontHeightInPoints((short) 14);
			stdFont.setColor(IndexedColors.DARK_RED.getIndex());
			// Create a CellStyle with the font
			CellStyle stdCellStyle = workbook.createCellStyle();
			stdCellStyle.setFont(stdFont);

			// Create a Font for styling diagonal cells
			Font diagonalFont = workbook.createFont();
			diagonalFont.setBold(true);
			diagonalFont.setFontHeightInPoints((short) 14);
			diagonalFont.setColor(IndexedColors.DARK_GREEN.getIndex());
			// Create a CellStyle with the font
			CellStyle diagonalCellStyle = workbook.createCellStyle();
			diagonalCellStyle.setFont(diagonalFont);
			
			// Create a Font for styling diagonal cells
			Font strataFont = workbook.createFont();
			strataFont.setBold(true);
			strataFont.setFontHeightInPoints((short) 16);
			strataFont.setColor(IndexedColors.BLUE.getIndex());
			// Create a CellStyle with the font
			CellStyle strataCellStyle = workbook.createCellStyle();
			strataCellStyle.setFont(strataFont);

			List<Integer> availableYears = new ArrayList<Integer>();
			for (StratumPerYearData yearDataStratumP : strataData) {
				if (!availableYears.contains(Integer.valueOf(yearDataStratumP.getYear()))) {
					availableYears.add(yearDataStratumP.getYear());
				}
			}

			for (Integer yearToOutput : availableYears) {

				int rowNum = 0;
				// Create a Sheet
				Sheet sheet = workbook.createSheet("LU Matrix " + yearToOutput + "-" + (yearToOutput + 1));

				for (StratumPerYearData yearDataStratum : strataData) {
					// Get the stratums for the year
					if (yearDataStratum.getYear() != yearToOutput) {
						continue; // The stratum contains data for a different year that we are going to output in
									// the sheet
					}


					sheet.createRow(rowNum++); // create empty row

					// Create a Row
					Row infoRow = sheet.createRow(rowNum++);
					Cell cell = infoRow.createCell(0);
					cell.setCellStyle(headerCellStyle);
					cell.setCellValue("Climate");
					cell = infoRow.createCell(1);
					cell.setCellStyle(strataCellStyle);
					cell.setCellValue(yearDataStratum.getClimate());

					infoRow = sheet.createRow(rowNum++);
					cell = infoRow.createCell(0);
					cell.setCellStyle(headerCellStyle);
					cell.setCellValue("Soil");
					cell = infoRow.createCell(1);
					cell.setCellStyle(strataCellStyle);
					cell.setCellValue(yearDataStratum.getSoil());

					infoRow = sheet.createRow(rowNum++);
					cell = infoRow.createCell(0);
					cell.setCellStyle(headerCellStyle);
					cell.setCellValue("Global Ecological Zone (GEZ)");
					cell = infoRow.createCell(1);
					cell.setCellStyle(strataCellStyle);
					cell.setCellValue(yearDataStratum.getGez());

					// Add some empty rows before next section
					sheet.createRow(rowNum++);

					// Create a Row
					Row headerRow = sheet.createRow(rowNum++);
					cell = headerRow.createCell(0);
					cell.setCellValue(
							"Transition " + yearDataStratum.getYear() + "/" + (yearDataStratum.getYear() + 1));
					cell.setCellStyle(cornerCellStyle);

					MatrixSheet matrix = new MatrixSheet(yearDataStratum);
					int cellPosition = 1;
					for (LandUseSubdivision<?> subdivision : matrix.getSubdivisions()) {
						cell = headerRow.createCell(cellPosition++);
						cell.setCellValue(subdivision.toString());
						cell.setCellStyle(headerCellStyle);
					}

					int colNum = 0;
					for (LandUseSubdivision<?> subdivisionH : matrix.getSubdivisions()) {
						colNum = 0;
						Row row = sheet.createRow(rowNum++);

						Cell columnCell = row.createCell(colNum++);
						columnCell.setCellStyle(headerCellStyle);
						columnCell.setCellValue(subdivisionH.toString());

						colNum = 1;
						for (LandUseSubdivision<?> subdivisionV : matrix.getSubdivisions()) {

							cell = row.createCell(colNum++);
							cell.setCellValue(IPCCDataExportMatrixExcel
									.findLuData(subdivisionH, subdivisionV, matrix.getYearData().getLuData())
									.getAreaHa());
							if (subdivisionH.equals(subdivisionV)) {
								cell.setCellStyle(diagonalCellStyle);
							} else {
								cell.setCellStyle(stdCellStyle);
							}
						}

					}
					
					// Add some empty rows before next section
					sheet.createRow(rowNum++);
					sheet.createRow(rowNum++);
					sheet.createRow(rowNum++);


					// Resize all columns to fit the content size
					for (int j = 0; j < colNum; j++) {
						sheet.autoSizeColumn(j);
					}

				}

			}

			// Write the output to a file
			try (FileOutputStream fileOut = new FileOutputStream(excelDestination)) {
				workbook.write(fileOut);
			} catch (IOException e) {
				logger.error("Error generating Excel file", e);
			}
		} catch (Exception e) {
			logger.error("Error generating Excel data", e);
		}
		return excelDestination;
	}

}
