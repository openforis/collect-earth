package org.openforis.collect.earth.app.view;

import java.awt.Toolkit;

import javax.swing.JFrame;
import javax.swing.ProgressMonitor;
import javax.swing.SwingUtilities;

import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.manager.process.AbstractProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ExportDialogProcessMonitor extends Thread {

	ProgressMonitor progressMonitor;
	Logger logger = LoggerFactory.getLogger(ExportDialogProcessMonitor.class);
	AbstractProcess<Void, DataExportStatus> exportProcess;
	private boolean onlyLastModifiedRecords;
	private DataFormat exportType;
	private EarthSurveyService earthSurveyService;
	private LocalPropertiesService localPropertiesService;

	public ExportDialogProcessMonitor(AbstractProcess<Void, DataExportStatus> exportProcess, JFrame parentFrame,  boolean onlyLastModifiedRecords, DataFormat exportType, EarthSurveyService earthSurveyService, LocalPropertiesService localPropertiesService ) {
		super();
		this.exportProcess = exportProcess;
		this.onlyLastModifiedRecords = onlyLastModifiedRecords;
		this.exportType = exportType;
		this.earthSurveyService = earthSurveyService;
		this.localPropertiesService = localPropertiesService;
		progressMonitor = new ProgressMonitor(parentFrame, Messages.getString("ExportDialogProcessMonitor.0"), Messages.getString("ExportDialogProcessMonitor.1"), 0, 100); //$NON-NLS-1$ //$NON-NLS-2$
		progressMonitor.setMillisToPopup(1000);
	}

	@Override
	public void run() {

		try {
			exportProcess.call();
			
			if( exportProcess.getStatus().isComplete() && exportType.equals( DataFormat.ZIP_WITH_XML ) && onlyLastModifiedRecords ){
				String surveyName = ""; //$NON-NLS-1$
				if( earthSurveyService.getCollectSurvey()!= null ){
					surveyName = earthSurveyService.getCollectSurvey().getName();
				}
				localPropertiesService.setLastExportedDate( surveyName );
			}
			
		} catch (final Exception e) {
			logger.error("Error starting the process", e); //$NON-NLS-1$
		}

	}

	@Override
	public synchronized void start() {

		new Thread() {
			@Override
			public void run() {
				boolean keepRunning = true;
				while (keepRunning) {
					if (exportProcess.getStatus() != null) {
						SwingUtilities.invokeLater(new Runnable() {

							@Override
							public void run() {
								progressMonitor.setProgress(exportProcess.getStatus().getProgressPercent());
								progressMonitor.setNote(Messages.getString("ExportDialogProcessMonitor.4") + exportProcess.getStatus().getProcessed() + "/" //$NON-NLS-1$ //$NON-NLS-2$
										+ exportProcess.getStatus().getTotal());
							}
						});

						if (progressMonitor.isCanceled() || exportProcess.getStatus().isComplete() || exportProcess.getStatus().isError() ) {
							SwingUtilities.invokeLater(new Runnable() {

								@Override
								public void run() {
									progressMonitor.close();
								}
							});
							Toolkit.getDefaultToolkit().beep();
							if ( !exportProcess.getStatus().isComplete() && !exportProcess.getStatus().isError() ) {
								exportProcess.cancel();
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
