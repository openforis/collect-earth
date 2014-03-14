package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.util.List;

import javax.swing.JFrame;
import javax.swing.JOptionPane;

import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class ImportActionListener implements ActionListener {
	private final DataFormat importFormat;
	private JFrame frame;
	private LocalPropertiesService localPropertiesService;
	private DataImportExportService dataImportService;
	private Logger logger = LoggerFactory.getLogger( ImportActionListener.class );

	public ImportActionListener(DataFormat importFormat, JFrame frame, LocalPropertiesService localPropertiesService, DataImportExportService dataImportService) {
		this.importFormat = importFormat;
		this.frame = frame;
		this.localPropertiesService = localPropertiesService;
		this.dataImportService = dataImportService;
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		try{
			CollectEarthWindow.startWaiting(frame);
			importDataFrom(e, importFormat );
		}finally{
			CollectEarthWindow.endWaiting( frame);
		}

	}
	
	private boolean shouldImportNonFinishedRecords() {
			final int selectedOption = JOptionPane.showConfirmDialog(null,

			"<html>" //$NON-NLS-1$
					+ "Should the data for plots that have not been completely filled be imported?" //$NON-NLS-1$
					+ "</html>",  //$NON-NLS-1$
					"Import non-finished records", 
					JOptionPane.YES_NO_OPTION);

			return (selectedOption == JOptionPane.YES_OPTION);
	}
	
	private void importDataFrom(final ActionEvent e, final DataFormat importType) {
		File[] filesToImport = JFileChooserExistsAware.getFileChooserResults( importType, false, true, null, localPropertiesService, frame );
		final ImportDialogProcessMonitor importDialogProcessMonitor = new ImportDialogProcessMonitor();
		if (filesToImport != null) {

			boolean importNonFinishedPlots = shouldImportNonFinishedRecords();
			switch (importType) {
			case ZIP_WITH_XML:
				for (final File importedFile : filesToImport) {
					new Thread("Import Thread " + importedFile.getName() ){
						public void run() {
							try{

								XMLDataImportProcess dataImportProcess = dataImportService.getImportSummary(importedFile);
								importDialogProcessMonitor.startImport(dataImportProcess, frame, dataImportService, importedFile );

							} catch (Exception e1) {
								JOptionPane.showMessageDialog( frame,  importedFile.getName() + " - " + Messages.getString("CollectEarthWindow.3"), importedFile.getName() + " - " + Messages.getString("CollectEarthWindow.7"), //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$
										JOptionPane.ERROR_MESSAGE);
								logger.error("Error importing data from " + importedFile.getAbsolutePath() + " in format " + importType.name() , e1); //$NON-NLS-1$ //$NON-NLS-2$
							} 
						};
					}.start();
				}

				break;
			case CSV:
				break;
			case FUSION:
				break;
			default:
				break;
			}
		}
	}
}
