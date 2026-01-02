package org.openforis.collect.earth.app.view;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.text.DateFormat;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;

import javax.swing.JFrame;
import javax.swing.JOptionPane;
import javax.swing.JPanel;

import org.apache.commons.lang3.StringUtils;
import org.jdesktop.swingx.JXDatePicker;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.manager.process.AbstractProcess;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class ExportActionListener implements ActionListener {
    private final DataFormat exportFormat;
    private JFrame frame;
    private LocalPropertiesService localPropertiesService;
    private DataImportExportService dataExportService;
    private EarthSurveyService earthSurveyService;
    private Logger logger = LoggerFactory.getLogger(ExportActionListener.class);
    private RecordsToExport recordsToExport;
    private KmlGeneratorService kmlGeneratorService;

    public enum RecordsToExport {
        ALL, MODIFIED_SINCE_LAST_EXPORT, PICK_FROM_DATE
    }

    public ExportActionListener(DataFormat exportFormat, RecordsToExport recordsToExport, JFrame frame,
            LocalPropertiesService localPropertiesService, DataImportExportService dataExportService,
            EarthSurveyService earthSurveyService, KmlGeneratorService kmlGeneratorService) {
        this.exportFormat = exportFormat;
        this.frame = frame;
        this.localPropertiesService = localPropertiesService;
        this.dataExportService = dataExportService;
        this.earthSurveyService = earthSurveyService;
        this.recordsToExport = recordsToExport;
        this.kmlGeneratorService = kmlGeneratorService;
    }

    @Override
    public void actionPerformed(ActionEvent e) {
        try {
            CollectEarthWindow.startWaiting(frame);

            Date recordsModifiedSince = null;
            if (recordsToExport.equals(RecordsToExport.MODIFIED_SINCE_LAST_EXPORT)) {
                String surveyName = ""; //$NON-NLS-1$
                if (earthSurveyService.getCollectSurvey() != null) {
                    surveyName = earthSurveyService.getCollectSurvey().getName();
                }
                recordsModifiedSince = localPropertiesService.getLastExportedDate(surveyName);
            } else if (recordsToExport.equals(RecordsToExport.PICK_FROM_DATE)) {
                recordsModifiedSince = getPickDateDlg();
                if (recordsModifiedSince == null) {
                    // No date chosen, do not proceed with the export
                    return;
                }
            }

            exportDataTo(exportFormat, recordsModifiedSince);
        } finally {
            CollectEarthWindow.endWaiting(frame);
        }

    }

    private Date getPickDateDlg() {

        JPanel panel = new JPanel();

        JXDatePicker picker = new JXDatePicker();
        picker.setDate(Calendar.getInstance().getTime());
        picker.setFormats(new SimpleDateFormat("dd.MM.yyyy")); //$NON-NLS-1$

        panel.add(picker);

        int result = JOptionPane.showConfirmDialog(frame, panel, Messages.getString("ExportActionListener.1"), //$NON-NLS-1$
                JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
        if (result == JOptionPane.OK_OPTION) {
            return picker.getDate();
        } else {
            return null;
        }
    }

    private File exportDataTo(DataFormat exportType, Date recordsModifiedSince) {
        // Informational warning for CSV exports
        if (exportType.equals(DataFormat.CSV)) {
            // Warn the user that CSV is for visualization but not shareable across Collect Earth instances
            JOptionPane.showMessageDialog(frame,
            		Messages.getString("ExportActionListener.2"), // $NON-NLS-1$
                "Information",
                JOptionPane.INFORMATION_MESSAGE);
        }

        String preselectedName = getPreselectedName(exportType, recordsModifiedSince);

        File[] exportToFile = FileChooserUtils.getFileChooserResults(exportType, true, false, preselectedName,
                localPropertiesService, frame);

        File exportedFile = null;
        if (exportToFile != null && exportToFile.length > 0) {
            startExportingData(exportType, recordsModifiedSince, exportToFile[0]);
            exportedFile = exportToFile[0];
        }

        return exportedFile;
    }

    private boolean promptForLabelInclusion(DataFormat exportType) {
        boolean includeLabels = false;

        if (exportType.equals(DataFormat.CSV)) {
            int result = JOptionPane.showConfirmDialog(frame, "Include labels for code attributes", "Include labels",
                    JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE);
            includeLabels = (result == JOptionPane.YES_OPTION);
        }

        return includeLabels;
    }

    private void startExportingData(DataFormat exportType, Date recordsModifiedSince, File exportToFile) {
        AbstractProcess<Void, DataExportStatus> exportProcess = null;
        try {
            exportProcess = getExportProcess(exportType, recordsModifiedSince, exportToFile);
            if (exportProcess != null) {
                ExportProcessMonitorDialog exportProcessWorker = new ExportProcessMonitorDialog(exportProcess, frame,
                        recordsToExport, exportType, earthSurveyService, exportToFile, localPropertiesService);
                exportProcessWorker.start();
            }
        } catch (Exception e1) {
            logger.error("What happened?", e1); //$NON-NLS-1$ //$NON-NLS-2$
            JOptionPane.showMessageDialog(this.frame, Messages.getString("CollectEarthWindow.0"), //$NON-NLS-1$
                    Messages.getString("CollectEarthWindow.1"), //$NON-NLS-1$
                    JOptionPane.ERROR_MESSAGE);
            logger.error(
                    "Error exporting data to " + exportToFile.getAbsolutePath() + " in format " + exportType.name(), //$NON-NLS-1$ //$NON-NLS-2$
                    e1);
        }
    }

    private AbstractProcess<Void, DataExportStatus> getExportProcess(DataFormat exportType, Date recordsModifiedSince,
            File exportToFile) throws Exception {
        AbstractProcess<Void, DataExportStatus> exportProcess = null;
        boolean addLabels = false;
        switch (exportType) {
        case CSV:
            addLabels = promptForLabelInclusion(exportType);
            exportProcess = dataExportService.exportSurveyAsCsv(exportToFile, addLabels);
            break;
        case ZIP_WITH_XML:
            exportProcess = dataExportService.exportSurveyAsZipWithXml(exportToFile, recordsModifiedSince);
            break;
        case FUSION:
            addLabels = promptForLabelInclusion(exportType);
            exportProcess = dataExportService.exportSurveyAsFusionTable(exportToFile, addLabels);
            break;
        case KML_FILE:
            kmlGeneratorService.exportToKml(exportToFile);
            CollectEarthUtils.openFolderInExplorer( exportToFile.getParent() );
            break;
        case COLLECT_BACKUP:
            exportProcess = dataExportService.exportSurveyAsBackup(exportToFile);
            break;
        default:
            break;
        }
        return exportProcess;
    }

    private String getPreselectedName(DataFormat exportType, Date modifiedSince) {

        String operator = "";

        try {
            operator = localPropertiesService.getOperator();

            operator = StringUtils.deleteWhitespace(operator);
            // Replaces character like Tĥïŝ ĩš â fůňķŷ Šťŕĭńġ with This is a funky String
            operator = Normalizer.normalize(operator, Normalizer.Form.NFD).replaceAll("[^\\p{ASCII}]", "");

            // Remove non-alphanumeric characters
            operator = operator.replaceAll("[^a-zA-Z0-9]", "");

        } catch (Exception e) {
            logger.error("Error normalizing operator name ", e);
        }

        String preselectName = operator + "_collectedData_"; //$NON-NLS-1$

        preselectName += earthSurveyService.getCollectSurvey().getName();
        DateFormat dateFormat = new SimpleDateFormat("ddMMyy_HHmmss"); //$NON-NLS-1$
        if (modifiedSince == null) {
            preselectName += "_on_" + dateFormat.format(new Date()); //$NON-NLS-1$
        } else {

            preselectName += "_" + dateFormat.format(modifiedSince) + "_to_" + dateFormat.format(new Date()); //$NON-NLS-1$ //$NON-NLS-2$
        }

        preselectName += "_" + exportType.name() + "." + exportType.getDefaultExtension(); //$NON-NLS-1$ //$NON-NLS-2$

        return preselectName;
    }
}
