package org.openforis.collect.earth.app.view;

import java.awt.Toolkit;
import java.util.List;

import javax.swing.JOptionPane;
import javax.swing.ProgressMonitor;
import javax.swing.SwingUtilities;

import org.apache.commons.lang.ArrayUtils;
import org.openforis.collect.io.data.CSVDataImportProcess;
import org.openforis.collect.io.metadata.parsing.ParsingError;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.collect.manager.process.ProcessStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class ProcessMonitorDialog<V,S extends ProcessStatus> extends Thread {

	ProgressMonitor progressMonitor;
	Logger logger = LoggerFactory.getLogger(ProcessMonitorDialog.class);
	AbstractProcess<V, S> process;


	protected abstract String getProcessActionMessage();
	
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
								progressMonitor.setNote(getProcessActionMessage() + process.getStatus().getProcessed() + "/" //$NON-NLS-1$ //$NON-NLS-2$
										+ process.getStatus().getTotal());
							}


						});

						if (progressMonitor.isCanceled() || process.getStatus().isComplete() || process.getStatus().isError() ) {
							SwingUtilities.invokeLater(new Runnable() {

								@SuppressWarnings("deprecation")
								@Override
								public void run(){
									progressMonitor.close();
									if( process.getStatus().isError() ){
										StringBuilder parsisngErrorMsg = new StringBuilder("\r\n");
										if( process instanceof CSVDataImportProcess ){
											List<ParsingError> errors = ((CSVDataImportProcess) process ).getStatus().getErrors();
											
											for (ParsingError parsingError : errors) {
												parsisngErrorMsg.append("Parsing error on row number ").append( parsingError.getRow() ).append(" - ").append( parsingError.getMessage() ).append(", ").append( parsingError.getErrorType() ).append(", columns ").append( ArrayUtils.toString(parsingError.getColumns()) ).append(" -- values ").append( ArrayUtils.toString(parsingError.getMessageArgs()) ).append("\r\n");
											}
										}
																				
										String primaryErrorMsg = process.getStatus().getErrorMessage();
										JOptionPane.showMessageDialog(null, "Attention : " + ( primaryErrorMsg!=null?primaryErrorMsg:"") + parsisngErrorMsg.toString() ); //$NON-NLS-1$
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
