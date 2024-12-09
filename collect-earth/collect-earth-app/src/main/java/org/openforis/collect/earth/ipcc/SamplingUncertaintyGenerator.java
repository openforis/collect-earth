package org.openforis.collect.earth.ipcc;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import org.apache.logging.log4j.core.util.FileUtils;
import org.apache.poi.ss.formula.BaseFormulaEvaluator;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.RDBConnector;
import org.openforis.collect.earth.app.service.RegionCalculationUtils;
import org.openforis.collect.earth.app.service.SchemaService;
import org.openforis.collect.earth.ipcc.model.LandUseCategoryConversion;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class SamplingUncertaintyGenerator extends RDBConnector {

	private final static String TEMPLATE_PATH = "resources/Uncertainty_Analysis_CollectEarth_Template.xlsx";

	private File templateFile;

	Logger logger = LoggerFactory.getLogger(SamplingUncertaintyGenerator.class);

	@Autowired
	private SchemaService schemaService;

	private String schemaName;

	public SamplingUncertaintyGenerator() {
		setExportTypeUsed(ExportType.IPCC);
	}
	
	// Read the excel file with the original content
	public Workbook getSamplingUncertainityTemplate() {
		try {
			templateFile = new File(TEMPLATE_PATH);
			return WorkbookFactory.create(templateFile);
		} catch (Exception e) {
			logger.error(TEMPLATE_PATH + " not accessible, problems reading Sampling Uncertainty Template", e);
			return null;
		}
	}
	
	public File getSamplingUncertainty( int initialYear, int finalYear) {
		List<LandUseCategoryConversion> luConversions = getLandUseConversions(initialYear, finalYear);
		return generateSamplignUncetaintyFile(luConversions, initialYear, finalYear);
		
	}

	private File generateSamplignUncetaintyFile(List<LandUseCategoryConversion> luConversions, int initialYear, int finalYear) {
		Workbook templateWorkbook = getSamplingUncertainityTemplate();
		if (templateWorkbook == null) {
			logger.info("Sampling Uncertainty file could not be created because the template was not available");
			return null;
		}

		updateTemplate(templateWorkbook, luConversions, initialYear, finalYear);

		return writeToFile(templateWorkbook, initialYear, finalYear);

	}

	private File writeToFile(Workbook templateWorkbook, int initialYear, int finalYear) {
		File tempFile = null;
		try {
			tempFile = File.createTempFile("Sampling_Uncertainty_" + initialYear + "_" + finalYear,
					"."+FileUtils.getFileExtension(templateFile));

			try (OutputStream bw = new BufferedOutputStream(new FileOutputStream(tempFile))) {
				templateWorkbook.write(bw);
			} catch (Exception e) {
				logger.error("Impossile to write Sampling uncertainty workbook data into temp file", e);
			}
			return tempFile;
		} catch (Exception e) {
			logger.error("Error creating temp file", e);
		}
		return tempFile;
	}

	private void updateTemplate(Workbook templateWorkbook, List<LandUseCategoryConversion> luConversions,
			int initialYear, int finalYear) {

		// The workbook has only one sheet
		Sheet sheet = templateWorkbook.getSheetAt(0);

		
		// Create a Font for styling FOREST LOST
		Font lossFont = templateWorkbook.createFont();
		lossFont.setBold(true);
		lossFont.setFontHeightInPoints((short) 14);
		lossFont.setColor(IndexedColors.BLACK.getIndex());
		// Create a CellStyle with the font
		CellStyle lossCellStyle = templateWorkbook.createCellStyle();
		lossCellStyle.setFont(lossFont);
		lossCellStyle.setFillBackgroundColor(IndexedColors.DARK_RED.getIndex());
		
		// Create a Font for styling FOREST GAIN
		Font gainFont = templateWorkbook.createFont();
		gainFont.setBold(true);
		gainFont.setFontHeightInPoints((short) 14);
		gainFont.setColor(IndexedColors.BLACK.getIndex());
		// Create a CellStyle with the font
		CellStyle gainCellStyle = templateWorkbook.createCellStyle();
		gainCellStyle.setFont(gainFont);
		gainCellStyle.setFillBackgroundColor(IndexedColors.DARK_GREEN.getIndex());
		
		// Create a Font for styling STABLE FOREST
		Font stableForestFont = templateWorkbook.createFont();
		stableForestFont.setBold(false);
		stableForestFont.setFontHeightInPoints((short) 14);
		stableForestFont.setColor(IndexedColors.BLACK.getIndex());
		// Create a CellStyle with the font
		CellStyle stableForestCellStyle = templateWorkbook.createCellStyle();
		stableForestCellStyle.setFont(stableForestFont);
		stableForestCellStyle.setFillBackgroundColor(IndexedColors.LIGHT_GREEN.getIndex());
		
		// Create a Font for styling STABLE NON FOREST
		Font stableNonForestFont = templateWorkbook.createFont();
		stableNonForestFont.setBold(false);
		stableNonForestFont.setFontHeightInPoints((short) 14);
		stableNonForestFont.setColor(IndexedColors.BLACK.getIndex());
		// Create a CellStyle with the font
		CellStyle stableNonForestCellStyle = templateWorkbook.createCellStyle();
		stableNonForestCellStyle.setFont(stableNonForestFont);
		stableNonForestCellStyle.setFillBackgroundColor(IndexedColors.LIGHT_BLUE.getIndex());
		
		// Create a Font for styling CHANGE NON FOREST
		Font changeNonForestFont = templateWorkbook.createFont();
		changeNonForestFont.setBold(false);
		changeNonForestFont.setFontHeightInPoints((short) 14);
		changeNonForestFont.setColor(IndexedColors.BLACK.getIndex());
		// Create a CellStyle with the font
		CellStyle changeNonForestCellStyle = templateWorkbook.createCellStyle();
		changeNonForestCellStyle.setFont(changeNonForestFont);
		changeNonForestCellStyle.setFillBackgroundColor(IndexedColors.PLUM.getIndex());
		
		
		// Land Use Conversion data should be set starting at row 6, columns A,B, C
		int rowTowWriteTo = 5; // the first row is 0 instead of 1
		for (LandUseCategoryConversion conversion : luConversions) {
			CellStyle styleToUse = null;
			if( conversion.getLuInitial().equals( conversion.getLuFinal()) && conversion.getLuFinal().equals( "F")) {
				styleToUse = stableForestCellStyle;
			}else if( conversion.getLuInitial().equals( "F")) {
				styleToUse = lossCellStyle;
			}else if( conversion.getLuFinal().equals( "F")) {
				styleToUse = gainCellStyle;
			}else if( !conversion.getLuInitial().equals( conversion.getLuFinal()) ) {
				styleToUse = changeNonForestCellStyle;
			}else if( conversion.getLuInitial().equals( conversion.getLuFinal()) ) {
				styleToUse = stableNonForestCellStyle;
			}
			
			Row row = sheet.getRow(rowTowWriteTo);
			Cell cellConversion = row.getCell(0);
			cellConversion.setCellValue(conversion.getLuInitial() + " > " + conversion.getLuFinal());
			cellConversion.setCellStyle(styleToUse);

			Cell cellPlotCount = row.getCell(1);
			cellPlotCount.setCellValue(conversion.getPlotCount());

			Cell cellArea = row.getCell(2);
			cellArea.setCellValue(conversion.getAreaHa());

			rowTowWriteTo++;
		}
		// Initial year cell 58B
		// Final Year cell 59B

		Row rowIY = sheet.getRow(57);
		Cell cellIY = rowIY.getCell(1);
		cellIY.setCellValue(initialYear);

		Row rowFY = sheet.getRow(58);
		Cell cellFY = rowFY.getCell(1);
		cellFY.setCellValue(finalYear);
		
		BaseFormulaEvaluator.evaluateAllFormulaCells(templateWorkbook);
	}

	private List<LandUseCategoryConversion> getLandUseConversions(int initialYear, int finalYear) {
		schemaName = schemaService.getSchemaPrefix(getExportTypeUsed());
		List<LandUseCategoryConversion> luData = getJdbcTemplate().query("select "
				+ IPCCSurveyAdapter.getIpccCategoryAttrName(initialYear) + ", "
				+ IPCCSurveyAdapter.getIpccCategoryAttrName(finalYear) + "," 
				+ " sum( "+ RegionCalculationUtils.EXPANSION_FACTOR + ") , " 
				+ " count( " + AbstractIPCCDataExportTimeSeries.PLOT_ID+ ") " 
				+ " from " + schemaName + AbstractIPCCDataExportTimeSeries.PLOT_TABLE + " where "
				+ EarthConstants.ACTIVELY_SAVED_ATTRIBUTE_NAME + " = " + EarthConstants.ACTIVELY_SAVED_BY_USER_VALUE
				+ " " // Only Actively saved plots so that there are no null Land Uses in the list
				+ " and " + EarthConstants.ROUND_ATTRIBUTE_NAME + " =  " + EarthConstants.ROUND_FIRST_ASSESSMENT_VALUE // Use only plots first assessment no QC plots																							
				+ " GROUP BY " + IPCCSurveyAdapter.getIpccCategoryAttrName(initialYear) + ","
				+ IPCCSurveyAdapter.getIpccCategoryAttrName(finalYear) 
				+ " ORDER BY " + IPCCSurveyAdapter.getIpccCategoryAttrName(initialYear) + ", " + IPCCSurveyAdapter.getIpccCategoryAttrName(finalYear) + " ASC "
				, getRowMapper());

		if (luData.size() == 0) { // No LU data for the climate, soil, gez combination
			logger.info("No data found that can be used for generating the Sampling Uncertainty analysis");
		}

		return luData;

	}

	protected RowMapper<LandUseCategoryConversion> getRowMapper() {
		return new RowMapper<LandUseCategoryConversion>() {
			@Override
			public LandUseCategoryConversion mapRow(ResultSet rs, int rowNum) throws SQLException {

				String categoryInitial = rs.getString(1);
				String categoryFinal = rs.getString(2);
				double area = rs.getDouble(3);
				int plotCount = rs.getInt(4);

				return new LandUseCategoryConversion(categoryInitial, categoryFinal, area, plotCount);
			}
		};
	}
	
	public static void main(String[] args) {
		
		List<LandUseCategoryConversion> luConversionTests = new ArrayList<LandUseCategoryConversion>();
		luConversionTests.add( new LandUseCategoryConversion("F", "F", 10000, 10));
		luConversionTests.add( new LandUseCategoryConversion("F", "C", 8000, 8));
		luConversionTests.add( new LandUseCategoryConversion("F", "G", 3000, 3));
		luConversionTests.add( new LandUseCategoryConversion("C", "C", 20000, 20));
		luConversionTests.add( new LandUseCategoryConversion("C", "G", 2000, 2));
		
		SamplingUncertaintyGenerator generator = new SamplingUncertaintyGenerator();
		File tempGenerated = generator.generateSamplignUncetaintyFile(luConversionTests, 2001, 2022);
		
		System.err.println(  "File generated " + tempGenerated );
	}

}
