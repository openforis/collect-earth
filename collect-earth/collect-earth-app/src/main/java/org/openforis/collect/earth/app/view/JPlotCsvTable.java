package org.openforis.collect.earth.app.view;

import java.awt.Color;
import java.awt.Component;
import java.awt.event.MouseEvent;
import java.io.File;
import java.io.IOException;
import java.util.List;

import javax.swing.JOptionPane;
import javax.swing.JTable;
import javax.swing.table.DefaultTableModel;
import javax.swing.table.TableCellRenderer;

import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.io.metadata.collectearth.CSVFileValidationResult;
import org.openforis.collect.io.metadata.collectearth.CSVRowValidationResult;
import org.openforis.collect.io.metadata.collectearth.CollectEarthGridTemplateGenerator;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

/**
 * Swing JTable used in the OptionWizard dialog.
 * It contains methods to refresh the information loaded on the cells.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class JPlotCsvTable extends JTable{

	private static final Color WARNING_BG_COLOR = new Color(254, 255, 196);
	private static final Color ERROR_BG_COLOR = new Color(218, 152, 152);
	private static final long serialVersionUID = 3456854921119125693L;
	private final Logger logger = LoggerFactory.getLogger(this.getClass());
	private CollectSurvey forSurvey;
	private CSVFileValidationResult validationResults;


	/**
	 * Build a new JTable that contains the data from the CSV that is set as the file that contains the plots used by Collect Earth
	 * @param pathToCsvWithPlots Path to the file containing the plot locations that should be loaded in the table 
	 */
	public JPlotCsvTable(String pathToCsvWithPlots, CollectSurvey forSurvey) {
		super();
		this.forSurvey = forSurvey;

		try {
			refreshTable(pathToCsvWithPlots);
		} catch (Exception e) {
			logger.error("Error loading plot file");
			this.setBackground(Color.RED);
			this.setToolTipText("The file chosen does not contain plot information");

		}
	}
	
	/**
	 * The data of the CSV file is validated when the CSV/CED is loaded. This method determines if the data currently loaded is valid or not
	 * @return True if the data is valid. False otherwise
	 */
	public boolean isDataValid(){
		return validationResults==null?true:validationResults.isSuccessful();
	}


	@Override
	public Component prepareRenderer(TableCellRenderer renderer, int row, int col) {
		Component comp = super.prepareRenderer(renderer, row, col);
	
		if ( cellHasError(row,col)){
			comp.setBackground( ERROR_BG_COLOR );
		}else{
			comp.setBackground(Color.WHITE);
		}
		
		return comp;
	}
	
	@Override
	public String getToolTipText(MouseEvent event) {
		 String tip = null;
         java.awt.Point p = event.getPoint();
         int row = rowAtPoint(p);
         int col = columnAtPoint(p);

         try {
             tip = getCellErrorMessage(row, col);
         } catch (RuntimeException e1) {
             //catch null pointer exception if mouse is over an empty line
         }
         
         return tip;
		
	}

	private boolean cellHasError(Integer row, Integer col) {		
		String errorMessage = getCellErrorMessage(row, col);
		return errorMessage!=null;
	}

	private String getCellErrorMessage(Integer row, Integer col) {		
		List<CSVRowValidationResult> rowValidations = validationResults.getRowValidations();
		for (CSVRowValidationResult csvRowValidationResult : rowValidations) {
			if( csvRowValidationResult.getRowNumber().equals(row+1) && csvRowValidationResult.getColumnPosition().equals( col  ) ){
				return csvRowValidationResult.getMessage();
			}
		}
		return null;
	}

	/**
	 * Refreshes the data loaded in the table. Used when the user changes the file that contains the CSV file using the OptionWizard dialog. 
	 * @param csvFilePath The path to the CSV file that contains the plot locations
	 */
	public void refreshTable(String csvFilePath) {

		if( csvFilePath.trim().length() == 0 )
			return;
		
		this.removeAll();		
		boolean errorLoading = false;		
		final File csvFile = new File(csvFilePath);
		
		if (csvFile.exists()) {
			DefaultTableModel newTableModel = getPlotTableModel( csvFilePath );
			
			validateCsvFile(csvFilePath);
			
			if (newTableModel.getRowCount() == 0) {
				errorLoading = true;
			} else {
				this.setModel(newTableModel);
			}
		} else {
			errorLoading = true;
		}

		if (errorLoading) {
			this.setBackground(CollectEarthWindow.ERROR_COLOR);
			this.setModel(new DefaultTableModel());
		}
	}

	private String[] getColumnNames() {
		// Check if the first line is actually a header. Possible if the first header column coincides with ID, PLOT_ID or PLOT
		CollectEarthGridTemplateGenerator cegtg = new CollectEarthGridTemplateGenerator();
		return cegtg.getExpectedHeaders( forSurvey ).toArray( new String[]{} );

	}

	private DefaultTableModel getPlotTableModel(String csvFilePath) {

		String[][] allValues = new String[0][0];

		try {
			CSVReader reader = CsvReaderUtils.getCsvReader(csvFilePath);
			List<String[]> allLines = reader.readAll();
			allValues = allLines.toArray(new String[][] {});	
		} catch (IOException e) {
			logger.error(" Error reading the CSV file " + csvFilePath);
		}

		return new DefaultTableModel( allValues , getColumnNames());
	}

	protected void validateCsvFile(String csvFilePath) {

		CollectEarthGridTemplateGenerator cegtg = new CollectEarthGridTemplateGenerator();
		CSVFileValidationResult validation = cegtg.validate( new File(csvFilePath), forSurvey);

		this.setBackground( Color.white ); 
		this.setValidationResults( validation );

		if( !validation.isSuccessful() ){
			switch (  validation.getErrorType() ) {
			case INVALID_FILE_TYPE:
				JPlotCsvTable.this.setBackground( ERROR_BG_COLOR);
				JOptionPane.showMessageDialog( JPlotCsvTable.this.getParent(), "The expected file type is CSV or CED ", "Expected File Type", JOptionPane.ERROR_MESSAGE);
				break;
				
			case INVALID_HEADERS:
				JPlotCsvTable.this.setBackground( ERROR_BG_COLOR);
				JOptionPane.showMessageDialog( JPlotCsvTable.this.getParent(), "The expected columns in the CSV are " + validation.getExpectedHeaders(), "Columns in CSV do not match survey", JOptionPane.ERROR_MESSAGE);
				break;

			case INVALID_NUMBER_OF_COLUMNS:
				JPlotCsvTable.this.setBackground( ERROR_BG_COLOR);
				JOptionPane.showMessageDialog( JPlotCsvTable.this.getParent(), "The expected file type is CSV or CED ", "Expected File Type", JOptionPane.ERROR_MESSAGE);
				break;

			case INVALID_NUMBER_OF_PLOTS_TOO_LARGE:
				JPlotCsvTable.this.setBackground( ERROR_BG_COLOR);
				JOptionPane.showMessageDialog( JPlotCsvTable.this.getParent(), "Using CSV files that are too large makes Google Earth extremely slow.\nPlease divide this CSV file into smaller file (reccomended less than 2000 plots per CSV file.\nNumber of plots in this file : " + validation.getNumberOfRows() , "File too large", JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
				break;

			case INVALID_NUMBER_OF_PLOTS_WARNING:
				JPlotCsvTable.this.setBackground( WARNING_BG_COLOR);
				JOptionPane.showMessageDialog( JPlotCsvTable.this.getParent(), "Using CSV files that are too large makes Google Earth slow.\n Please divide this CSV file into smaller file (reccomended size is less than 2000 plots per CSV file.\nNumber of plots in this file : " + validation.getNumberOfRows() ,  "File too large", JOptionPane.WARNING_MESSAGE); //$NON-NLS-1$
				break;

			case INVALID_VALUES_IN_CSV:
				// IN THIS CASE THE CELL RENDERER TAKES CARE OF HIGHLIGHTING THE CELLS!!!
				JOptionPane.showMessageDialog( JPlotCsvTable.this.getParent(), "The content of the CSV file is not correct!! The values on the cells highlighted are incorrect " , "CSV content is not correct", JOptionPane.ERROR_MESSAGE); //$NON-NLS-1$
				break;

			default:
				break;
			}
		}
	}


	private void setValidationResults(CSVFileValidationResult validationResults) {
		this.validationResults = validationResults;
	}

}
