package org.openforis.collect.earth.app.view;

import java.awt.Color;
import java.io.File;
import java.io.IOException;
import java.util.List;

import javax.swing.JTable;
import javax.swing.table.DefaultTableModel;

import org.apache.commons.lang.ArrayUtils;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
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
	private static final long serialVersionUID = 3456854921119125693L;
	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	/**
	 * Build a new JTable that contains the data from the CSV that is set as the file that contains the plots used by Collect Earth
	 * @param pathToCsvWithPlots Path to the file containing the plot locations that should be loaded in the table 
	 */
	public JPlotCsvTable(String pathToCsvWithPlots) {
		super();
		
		try {
			this.setModel( 
					getPlotTableModel( pathToCsvWithPlots )
				);
		} catch (Exception e) {
			logger.error("Error loading plot file");
			this.setBackground(Color.RED);
			this.setToolTipText("The file chosen does not contain plot information");
			
		}
	}


		
	
	/**
	 * Refreshes the data loaded in the table. Used when the user changes the file that contains the CSV file using the OptionWizard dialog. 
	 * @param csvFilePath The path to the CSV file that contains the plot locations
	 */
	public void refreshTable(String csvFilePath) {
		
		this.removeAll();		
		boolean errorLoading = false;		
		final File csvFile = new File(csvFilePath);
		
		if (csvFile.exists()) {
			DefaultTableModel newTableModel = getPlotTableModel( csvFilePath );
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
		} else {
			this.setBackground(Color.white);
		}
		
	}

	private String[] getColumnNames(String[] headerRow) {
		// Check if the first line is actually a header. Possible if the first header column coincides with ID, PLOT_ID or PLOT
		if( headerRow == null ){
			return new String[]{"No headers"};
		}
		if( headerRow[0].equalsIgnoreCase("id") || headerRow[0].equalsIgnoreCase("plot_id") || headerRow[0].equalsIgnoreCase("plot") || headerRow[0].equalsIgnoreCase("name") ){
			return headerRow;
		}else{
			String[] columns = new String[6];
			columns[0]=(Messages.getString("OptionWizard.16")); //$NON-NLS-1$
			columns[1]=(Messages.getString("OptionWizard.18")); //$NON-NLS-1$
			columns[2]=(Messages.getString("OptionWizard.17")); //$NON-NLS-1$
			columns[3]=(Messages.getString("OptionWizard.19")); //$NON-NLS-1$
			columns[4]=(Messages.getString("OptionWizard.22")); //$NON-NLS-1$
			columns[5]=("Aspect");
			
			int numberOfExtraColumns = headerRow.length - columns.length;
			if( numberOfExtraColumns > 0 ){
				String[] extraColumns = new String[ numberOfExtraColumns ];
				for (int i = 0; i < numberOfExtraColumns; i++) {
					extraColumns[i] = "extraInfo[" + i + "]";
				}
				return (String[]) ArrayUtils.addAll( columns, extraColumns );
			}else{			
				return columns;
			}
			
		}
		
	}

	private DefaultTableModel getPlotTableModel(String csvFilePath) {
		
		String[][] allValues = new String[0][0];
		String[] headerRow = new String[0];
		try {
			CSVReader reader = CsvReaderUtils.getCsvReader(csvFilePath);
			List<String[]> allLines = reader.readAll();
			allValues = allLines.toArray(new String[][] {});
			headerRow = getColumnNames( allValues[0] );
		} catch (IOException e) {
			logger.error(" Error reading the CSV file " + csvFilePath);
		}
		
		return new DefaultTableModel( allValues , headerRow);
	}

}
