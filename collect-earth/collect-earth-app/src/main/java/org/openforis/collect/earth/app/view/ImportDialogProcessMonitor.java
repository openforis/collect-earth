package org.openforis.collect.earth.app.view;

import java.awt.Toolkit;
import java.io.File;
import java.util.List;

import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.io.data.DataImportSummaryItem;
import org.openforis.collect.io.data.XMLDataImportProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ImportDialogProcessMonitor {

	Logger logger = LoggerFactory.getLogger(ImportDialogProcessMonitor.class);
	private InfiniteProgressMonitor progressMonitor;

	public void closeProgressmonitor() {
		if (progressMonitor != null) {
			progressMonitor.close();
		}
	}

	private boolean shouldAddConflictingRecords(List<DataImportSummaryItem> listConflictingRecords, String importedFileName) {

		if (listConflictingRecords.size() > 0) {

			final int selectedOption = JOptionPane.showConfirmDialog(null,

			"<html>" //$NON-NLS-1$
					+ "<b>" + importedFileName + " : </b></br>" //$NON-NLS-1$ //$NON-NLS-2$
					+ Messages.getString("CollectEarthWindow.9") //$NON-NLS-1$
					+ "<br>" //$NON-NLS-1$
					+ Messages.getString("CollectEarthWindow.20") + listConflictingRecords.size()  //$NON-NLS-1$
					+ "<br>" //$NON-NLS-1$
					+ Messages.getString("CollectEarthWindow.25") //$NON-NLS-1$
					+ "<br>" //$NON-NLS-1$
					+ "<i>" //$NON-NLS-1$
					+ Messages.getString("CollectEarthWindow.39") //$NON-NLS-1$
					+ "</i>" //$NON-NLS-1$
					+ "</html>",  //$NON-NLS-1$

					Messages.getString("CollectEarthWindow.43"), //$NON-NLS-1$

					JOptionPane.YES_NO_OPTION);

			return (selectedOption == JOptionPane.YES_OPTION);
		} else {
			return false;
		}
	}

	public synchronized void startImport(final XMLDataImportProcess importProcess, final JFrame parentFrame,
			final DataImportExportService dataImportService, final File importedFile ) {

		try {
			
			SwingUtilities.invokeLater(new Runnable() {
				@Override
				public void run() {

					progressMonitor = new InfiniteProgressMonitor(parentFrame, Messages.getString("ImportDialogProcessMonitor.8") + "(" //$NON-NLS-1$ //$NON-NLS-2$
							+ importedFile.getName() + ")", Messages.getString("ImportDialogProcessMonitor.11") + Messages.getString("ImportDialogProcessMonitor.0")); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$
					progressMonitor.show();

					if (progressMonitor != null && progressMonitor.isUserCancelled()) {

						Toolkit.getDefaultToolkit().beep();
						importProcess.cancel();
						logger.warn("Import Task canceled.\n"); //$NON-NLS-1$

					}
				}
			});

			importProcess.call();
			
			if (importProcess.getSummary() != null && !importProcess.getState().isCancelled()) {

				final List<DataImportSummaryItem> conflictingRecords = importProcess.getSummary().getConflictingRecords();

				if ( conflictingRecords != null && conflictingRecords.size() > 0) {

					if (!shouldAddConflictingRecords(conflictingRecords, importedFile.getName())) {
						conflictingRecords.clear();
					}
				}
				int totalRecords = ( conflictingRecords==null?0:conflictingRecords.size() ) + importProcess.getSummary().getRecordsToImport().size();
				progressMonitor.setMessage( Messages.getString("ImportDialogProcessMonitor.11") + totalRecords ); //$NON-NLS-1$
				
				dataImportService.importRecordsFrom(importedFile, importProcess, conflictingRecords );
			}
		} catch (final Exception e1) {
			logger.error("", e1); //$NON-NLS-1$
		} finally {
			closeProgressmonitor();
		}

	}

}
