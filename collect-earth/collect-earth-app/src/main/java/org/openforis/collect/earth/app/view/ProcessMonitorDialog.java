package org.openforis.collect.earth.app.view;

import java.awt.Toolkit;

import javax.swing.JOptionPane;
import javax.swing.ProgressMonitor;
import javax.swing.SwingUtilities;

import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.manager.process.ProcessStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class ProcessMonitorDialog<V,S extends ProcessStatus> extends Thread {

	ProgressMonitor progressMonitor;
	Logger logger = LoggerFactory.getLogger(ProcessMonitorDialog.class);
	AbstractProcess<V, S> process;


	@Override
	public synchronized void start() {

		new Thread() {
			@Override
			public void run() {
				boolean keepRunning = true;
				while (keepRunning) {
					if (process.getStatus() != null) {
						SwingUtilities.invokeLater(new Runnable() {
							@Override
							public void run() {
								progressMonitor.setProgress(process.getStatus().getProgressPercent());
								progressMonitor.setNote(Messages.getString("ExportDialogProcessMonitor.4") + process.getStatus().getProcessed() + "/" //$NON-NLS-1$ //$NON-NLS-2$
										+ process.getStatus().getTotal());
							}
						});

						if (progressMonitor.isCanceled() || process.getStatus().isComplete() || process.getStatus().isError() ) {
							SwingUtilities.invokeLater(new Runnable() {

								@Override
								public void run(){
									progressMonitor.close();
									if( process.getStatus().isError() ){
										JOptionPane.showMessageDialog(null, "Error : " +process.getStatus().getErrorMessage() ); //$NON-NLS-1$
									}
								}
							});
							Toolkit.getDefaultToolkit().beep();
							if ( !process.getStatus().isComplete() && !process.getStatus().isError() ) {
								process.cancel();
								logger.warn("Task canceled.\n"); //$NON-NLS-1$
							}
							keepRunning = false;
						}
					}
					
					try {
						Thread.sleep( 1000 );
					} catch (InterruptedException e) {
						logger.error("Error whille waiting in thread", e); //$NON-NLS-1$
					}
				}
			};
		}.start();
		super.start();

	}

}
