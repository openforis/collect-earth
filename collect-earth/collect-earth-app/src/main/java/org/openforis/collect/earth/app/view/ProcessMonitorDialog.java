package org.openforis.collect.earth.app.view;

import java.awt.Toolkit;
import java.util.List;

import javax.swing.JOptionPane;
import javax.swing.ProgressMonitor;
import javax.swing.SwingUtilities;

import org.apache.commons.lang3.ArrayUtils;
import org.openforis.collect.io.data.CSVDataImportProcess;
import org.openforis.collect.io.metadata.parsing.ParsingError;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.manager.process.ProcessStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class ProcessMonitorDialog<V,S extends ProcessStatus> extends Thread {

	private static final int MAX_ERRORS_SHOWN = 10;
	ProgressMonitor progressMonitor;
	Logger logger = LoggerFactory.getLogger(ProcessMonitorDialog.class);
	AbstractProcess<V, S> process;


	protected abstract String getProcessActionMessage();

	public synchronized void monitorProgress() {

		new Thread("Monitoring progress of a process") {
			@Override
			public void run() {
				boolean keepRunning = true;
				while (keepRunning) {
					final AbstractProcess<V, S> currentProcess = process;
					final S status = currentProcess == null ? null : currentProcess.getStatus();
					final ProgressMonitor monitor = progressMonitor;
					if (status != null && monitor != null) {
						SwingUtilities.invokeLater( () -> {
								monitor.setProgress(status.getProgressPercent());
								monitor.setNote(getProcessActionMessage() + status.getProcessed() + "/" //$NON-NLS-1$ //$NON-NLS-2$
										+ status.getTotal());
						});

						if (monitor.isCanceled() || status.isComplete() || status.isError() ) {
							SwingUtilities.invokeLater( () -> {
									monitor.close();
									if( status.isError() ){
										StringBuilder parsisngErrorMsg = new StringBuilder("\r\n"); //$NON-NLS-1$
										if( currentProcess instanceof CSVDataImportProcess ){
											List<ParsingError> errors = ((CSVDataImportProcess) currentProcess ).getStatus().getErrors();

											int numberOfErrors = 0;
											for (ParsingError parsingError : errors) {
												parsisngErrorMsg.append(Messages.getString("ProcessMonitorDialog.1")).append( parsingError.getRow() ).append(" - ").append( parsingError.getMessage() ).append(", ").append( parsingError.getErrorType() ).append(Messages.getString("ProcessMonitorDialog.4")).append( ArrayUtils.toString(parsingError.getColumns()) ).append(Messages.getString("ProcessMonitorDialog.5")).append( ArrayUtils.toString(parsingError.getMessageArgs()) ).append("\r\n"); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$
												numberOfErrors ++;
												if( numberOfErrors > MAX_ERRORS_SHOWN ){
													break;
												}
											}

											if( errors.size() > MAX_ERRORS_SHOWN ){
												parsisngErrorMsg.append( "More lines not shown . Total warnings : " + errors.size() );
											}

										}

										String primaryErrorMsg = status.getErrorMessage();
										JOptionPane.showMessageDialog(null, "Attention : " + ( primaryErrorMsg!=null?primaryErrorMsg:"") + parsisngErrorMsg.toString() ); //$NON-NLS-1$ //$NON-NLS-2$
									}
							});
							Toolkit.getDefaultToolkit().beep();
							if ( !status.isComplete() && !status.isError() ) {
								currentProcess.cancel();
								logger.warn("Task canceled.\n"); //$NON-NLS-1$
							}
							keepRunning = false;
						}
					}

					try {
						Thread.sleep( 1000 );
					} catch (InterruptedException e) {
						logger.error("Error whille waiting in thread", e); //$NON-NLS-1$
						Thread.currentThread().interrupt();
					}
				}
			}
		}.start();
	}

}
