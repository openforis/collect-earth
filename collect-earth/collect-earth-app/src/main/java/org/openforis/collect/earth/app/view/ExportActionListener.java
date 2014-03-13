package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Date;

import javax.swing.JFrame;
import javax.swing.JOptionPane;

import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.manager.process.AbstractProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class ExportActionListener implements ActionListener {
	private final DataFormat exportFormat;
	private final boolean onlyLastModifiedRecords;
	private JFrame frame;
	private LocalPropertiesService localPropertiesService;
	private DataImportExportService dataExportService;
	private EarthSurveyService earthSurveyService;
	private Logger logger = LoggerFactory.getLogger( ExportActionListener.class);

	public ExportActionListener(DataFormat exportFormat, boolean onlyLastModifiedRecords, JFrame frame, LocalPropertiesService localPropertiesService, DataImportExportService dataExportService, EarthSurveyService earthSurveyService) {
		this.exportFormat = exportFormat;
		this.onlyLastModifiedRecords = onlyLastModifiedRecords;
		this.frame = frame;
		this.localPropertiesService = localPropertiesService;
		this.dataExportService = dataExportService;
		this.earthSurveyService = earthSurveyService;
	}

	@Override
	public void actionPerformed(ActionEvent e) {


		try{
			CollectEarthWindow.startWaiting(frame);
			exportDataTo(e, exportFormat, onlyLastModifiedRecords  );
		}finally{
			CollectEarthWindow.endWaiting(frame);
		}

	}
	
	private void exportDataTo(ActionEvent e, DataFormat exportType, boolean onlyLastModifiedRecords) {

		Date recordsModifiedSince = null;
		if( onlyLastModifiedRecords ){
			String surveyName = ""; //$NON-NLS-1$
			if( earthSurveyService.getCollectSurvey()!= null ){
				surveyName = earthSurveyService.getCollectSurvey().getName();
			}
			recordsModifiedSince = localPropertiesService.getLastExportedDate( surveyName );
		}

		String preselectedName = getPreselectedName(exportType, recordsModifiedSince);

		File[] exportToFile = JFileChooserExistsAware.getFileChooserResults( exportType, true, false, preselectedName, localPropertiesService, frame);

		if (exportToFile != null && exportToFile.length > 0) {

			startExportingData(exportType, onlyLastModifiedRecords, recordsModifiedSince, exportToFile); 
		}
	}
	
	private void startExportingData(DataFormat exportType, boolean onlyLastModifiedRecords, Date recordsModifiedSince, File[] exportToFile) {
		AbstractProcess<Void, DataExportStatus> exportProcess = null ;
		try {
			exportProcess = getExportProcess(exportType, recordsModifiedSince, exportToFile);
			if( exportProcess != null ){
				ExportDialogProcessMonitor exportProcessWorker = new ExportDialogProcessMonitor(exportProcess, frame, onlyLastModifiedRecords, exportType, earthSurveyService, localPropertiesService );
				exportProcessWorker.start();
			}
		} catch (Exception e1) {
			JOptionPane.showMessageDialog(this.frame, Messages.getString("CollectEarthWindow.0"), Messages.getString("CollectEarthWindow.1"), //$NON-NLS-1$ //$NON-NLS-2$
					JOptionPane.ERROR_MESSAGE);
			logger.error("Error exporting data to " + exportToFile[0].getAbsolutePath() + " in format " + exportType.name() , e1); //$NON-NLS-1$ //$NON-NLS-2$
		}
	}

	private AbstractProcess<Void, DataExportStatus> getExportProcess(DataFormat exportType, Date recordsModifiedSince, File[] exportToFile) throws Exception {
		AbstractProcess<Void, DataExportStatus> exportProcess = null ;
		switch (exportType) {
		case CSV:
			exportProcess = dataExportService.exportSurveyAsCsv(exportToFile[0]);
			break;
		case ZIP_WITH_XML:
			exportProcess = dataExportService.exportSurveyAsZipWithXml(exportToFile[0], recordsModifiedSince);
			break;
		case FUSION:
			exportProcess = dataExportService.exportSurveyAsFusionTable(exportToFile[0]);
			break;
		default:
			break;
		}
		return exportProcess;
	}

	private String getPreselectedName(DataFormat exportType, Date modifiedSince) {
		String preselectName = "collectDataExport"; //$NON-NLS-1$
		if( modifiedSince == null ){
			preselectName += "_FULL"; //$NON-NLS-1$
		}else{
			DateFormat dateFormat = new SimpleDateFormat("ddMMyy_HHmmss"); //$NON-NLS-1$
			preselectName += "_" + dateFormat.format(modifiedSince) + "_to_" + dateFormat.format( new Date() ); //$NON-NLS-1$ //$NON-NLS-2$
		}

		preselectName += "." + exportType.getFileExtension(); //$NON-NLS-1$

		return preselectName;
	}



}
