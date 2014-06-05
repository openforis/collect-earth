package org.openforis.collect.earth.app.view;

import javax.swing.JFrame;
import javax.swing.ProgressMonitor;

import org.openforis.collect.io.ReferenceDataImportStatus;
import org.openforis.collect.io.metadata.parsing.ParsingError;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.utils.ExecutorServiceUtil;

public class ImportProcessMonitorDialog extends ProcessMonitorDialog<Void, ReferenceDataImportStatus<ParsingError>> {


	public ImportProcessMonitorDialog(AbstractProcess<Void, ReferenceDataImportStatus<ParsingError>> importProcess, JFrame parentFrame ) {
		super();
		this.process = importProcess;
		progressMonitor = new ProgressMonitor(parentFrame, Messages.getString("ExportDialogProcessMonitor.0"), Messages.getString("ExportDialogProcessMonitor.1"), 0, 100); //$NON-NLS-1$ //$NON-NLS-2$
		progressMonitor.setMillisToPopup(1000);
	}

	@Override
	public void run() {

		try {
			ExecutorServiceUtil.executeInCachedPool(process);
			
		} catch (final Exception e) {
			logger.error("Error starting the process", e); //$NON-NLS-1$
		}

	}

}
