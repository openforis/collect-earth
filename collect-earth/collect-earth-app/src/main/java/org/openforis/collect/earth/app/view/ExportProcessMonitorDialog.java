package org.openforis.collect.earth.app.view;

import java.awt.Desktop;
import java.io.File;
import java.io.IOException;

import javax.swing.JFrame;
import javax.swing.ProgressMonitor;

import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.ExportActionListener.RecordsToExport;
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.manager.process.AbstractProcess;

public class ExportProcessMonitorDialog extends ProcessMonitorDialog<Void, DataExportStatus> {


	private RecordsToExport recordsToExport;
	private DataFormat exportFormat;
	private EarthSurveyService earthSurveyService;
	private LocalPropertiesService localPropertiesService;
	private File exportToFile;

	public ExportProcessMonitorDialog(AbstractProcess<Void, DataExportStatus> exportProcess, JFrame parentFrame,  RecordsToExport recordsToExport, DataFormat exportFormat, EarthSurveyService earthSurveyService, File exportToFile, LocalPropertiesService localPropertiesService ) {
		super();
		this.process = exportProcess;
		this.recordsToExport = recordsToExport;
		this.exportFormat = exportFormat;
		this.earthSurveyService = earthSurveyService;
		this.exportToFile = exportToFile;
		this.localPropertiesService = localPropertiesService;
		progressMonitor = new ProgressMonitor(parentFrame, Messages.getString("ExportDialogProcessMonitor.0"), Messages.getString("ExportDialogProcessMonitor.1"), 0, 100); //$NON-NLS-1$ //$NON-NLS-2$
		progressMonitor.setMillisToPopup(1000);
	}

	protected String getProcessActionMessage() {
		return Messages.getString("ExportDialogProcessMonitor.4"); //$NON-NLS-1$
	}
	
	@Override
	public void run() {

		try {
			process.call();
			if( process.getStatus().isComplete() && exportFormat.equals( DataFormat.ZIP_WITH_XML ) && recordsToExport.equals(RecordsToExport.MODIFIED_SINCE_LAST_EXPORT) ){
				String surveyName = ""; //$NON-NLS-1$
					if( earthSurveyService.getCollectSurvey()!= null ){
						surveyName = earthSurveyService.getCollectSurvey().getName();
					}
					localPropertiesService.setLastExportedDate( surveyName );
				
			}
			
			if( process.getStatus().isComplete() && exportFormat.equals( DataFormat.CSV ) || exportFormat.equals( DataFormat.FUSION ) || exportFormat.equals( DataFormat.KML_FILE ) ) {
				openFile( exportToFile );
			}
			
		} catch (final Exception e) {
			logger.error("Error starting the process", e); //$NON-NLS-1$
		}

	}

private void openFile(File exportedFile) {
if (Desktop.isDesktopSupported()) {
    try {
        Desktop.getDesktop().open(exportedFile);
    } catch (IOException ex) {
        logger.warn("No application registered to open file " + exportedFile.getAbsolutePath() ); //$NON-NLS-1$
    }
}
}
}
