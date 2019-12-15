package org.openforis.collect.earth.app.view;

import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.ProgressMonitor;
import javax.swing.SwingUtilities;

import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.io.ReferenceDataImportStatus;
import org.openforis.collect.io.metadata.parsing.ParsingError;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.utils.ExecutorServiceUtil;

public class ImportProcessMonitorDialog extends ProcessMonitorDialog<Void, ReferenceDataImportStatus<ParsingError>> {

	private JFrame parentFrame;


	public ImportProcessMonitorDialog(AbstractProcess<Void, ReferenceDataImportStatus<ParsingError>> importProcess, JFrame parentFrame ) {
		super();
		this.process = importProcess;
		this.parentFrame = parentFrame;
		SwingUtilities.invokeLater( () -> {
				progressMonitor = new ProgressMonitor(parentFrame, Messages.getString("ExportDialogProcessMonitor.0"), Messages.getString("ExportDialogProcessMonitor.1"), 0, 100); //$NON-NLS-1$ //$NON-NLS-2$
				progressMonitor.setMillisToPopup(1000);
		} );
	}

	protected String getProcessActionMessage() {
		return Messages.getString("ImportProcessMonitorDialog.0"); //$NON-NLS-1$
	}
	
	
	@Override
	public void run() {

		try {
			monitorProgress();
			process.call();
			if( process.getStatus().isComplete() ) {
				JOptionPane.showMessageDialog( parentFrame, "Update finished", "CSV Update", JOptionPane.INFORMATION_MESSAGE);
			}
		} catch (final Exception e) {
			logger.error("Error starting the process", e); //$NON-NLS-1$
		}

	}

}
