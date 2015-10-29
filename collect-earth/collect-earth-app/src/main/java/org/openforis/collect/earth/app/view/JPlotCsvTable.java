package org.openforis.collect.earth.app.view;

import java.awt.Color;
import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.Vector;

import javax.swing.JOptionPane;
import javax.swing.JTable;
import javax.swing.table.DefaultTableModel;

import org.apache.commons.lang.ArrayUtils;
import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.processor.KmlGenerator;
import org.openforis.collect.earth.sampler.processor.PlotProperties;
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
	private static final long serialVersionUID = 3456854921119125693L;
	private final Logger logger = LoggerFactory.getLogger(this.getClass());
	private CollectSurvey collectSurvey;

	/**
	 * Build a new JTable that contains the data from the CSV that is set as the file that contains the plots used by Collect Earth
	 * @param pathToCsvWithPlots Path to the file containing the plot locations that should be loaded in the table 
	 */
	public JPlotCsvTable(String pathToCsvWithPlots, CollectSurvey collectSurvey) {
		super();
		this.collectSurvey = collectSurvey;
		this.setModel( 
				getPlotTableModel( pathToCsvWithPlots )
			);
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
		if( headerRow[0].equalsIgnoreCase("id") || headerRow[0].equalsIgnoreCase("plot_id")|| headerRow[0].equalsIgnoreCase("plot")){
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
		
		String[] headerRow =null;
		final Vector<Vector<Object>> plots = new Vector<Vector<Object>>();
		
		headerRow = readCsvContents(csvFilePath, headerRow, plots);
		
		return new DefaultTableModel( plots , new Vector<String>(Arrays.asList(getColumnNames(headerRow))));
	}


	public String[] readCsvContents(String csvFilePath, String[] headerRow, final Vector<Vector<Object>> plots) {
		CSVReader reader = null;
		String[] csvRow;
		
		File csvFile = new File(csvFilePath);
		if( csvFile.exists() ){
			try {
				
				reader = CsvReaderUtils.getCsvReader(csvFilePath);
				try {
					while ((csvRow = reader.readNext()) != null && plots.size() < 50) {

						if( headerRow == null ){
							headerRow = csvRow;
						}

						try {
							final PlotProperties plotProperties = KmlGenerator.getPlotProperties(csvRow, headerRow, collectSurvey);
							final Vector<Object> props = new Vector<Object>();
							props.add(plotProperties.id);
							props.add(plotProperties.yCoord);
							props.add(plotProperties.xCoord);
							props.add(plotProperties.elevation);
							props.add(plotProperties.slope);
							props.add(plotProperties.aspect);
							if ( plotProperties.extraInfo!= null )
							{
								for (String extra : plotProperties.extraInfo) {
									props.add(extra);
								}
								props.add(plotProperties.aspect);
							}
							plots.add(props);
						} catch (Exception e) {
							logger.error("Probably the first line containing the headers " + Arrays.toString(csvRow), e);
						}

					}
				} catch (final Exception e) {
					JOptionPane.showMessageDialog(this, Messages.getString("OptionWizard.38") //$NON-NLS-1$
							+ Messages.getString("OptionWizard.39") + "\n" + e.getMessage(), "Error reading file contents", //$NON-NLS-1$ //$NON-NLS-2$
							JOptionPane.ERROR_MESSAGE);
					logger.error("Error reading the CSV with the plot locations", e);
				}
			} catch (final IOException e) {
				logger.error("Error when extracting data from CSV file " + csvFilePath, e); //$NON-NLS-1$
			} finally {
				if (reader != null) {
					try {
						reader.close();
					} catch (final IOException e) {
						logger.error(Messages.getString("OptionWizard.42"), e); //$NON-NLS-1$
					}
				}
			}
		}
		return headerRow;
	}

}
