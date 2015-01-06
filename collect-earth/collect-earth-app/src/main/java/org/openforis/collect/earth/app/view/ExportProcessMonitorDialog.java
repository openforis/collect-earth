package org.openforis.collect.earth.app.view;

import javax.swing.JFrame;
import javax.swing.ProgressMonitor;

import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.ExportActionListener.RecordsToExport;
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.manager.process.AbstractProcess;

public class ExportProcessMonitorDialog extends ProcessMonitorDialog<Void, DataExportStatus> {


	private RecordsToExport recordsToExport;
	private DataFormat exportType;
	private EarthSurveyService earthSurveyService;
	private LocalPropertiesService localPropertiesService;

	public ExportProcessMonitorDialog(AbstractProcess<Void, DataExportStatus> exportProcess, JFrame parentFrame,  RecordsToExport recordsToExport, DataFormat exportType, EarthSurveyService earthSurveyService, LocalPropertiesService localPropertiesService ) {
		super();
		this.process = exportProcess;
		this.recordsToExport = recordsToExport;
		this.exportType = exportType;
		this.earthSurveyService = earthSurveyService;
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
			if( process.getStatus().isComplete() && exportType.equals( DataFormat.ZIP_WITH_XML ) && recordsToExport.equals(RecordsToExport.MODIFIED_SINCE_LAST_EXPORT) ){
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

}
