package org.openforis.collect.earth.app.view;

import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.text.DateFormat;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;

import javax.swing.JComboBox;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JTextField;

import org.apache.commons.lang3.StringUtils;
import org.jdesktop.swingx.JXDatePicker;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.service.DataImportExportService;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.KmlGeneratorService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.io.data.DataExportStatus;
import org.openforis.collect.manager.process.AbstractProcess;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.openforis.idm.metamodel.EntityDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class ExportActionListener implements ActionListener {

	/**
	 * Collect only stores the first key and summary attributes of the root entity as searchable
	 * columns (KEY1..KEY3 and SUMMARY1..SUMMARY3) of the record table, so only those can be used to
	 * filter the records to export.
	 */
	private static final int MAX_FILTERABLE_ATTRIBUTES = 3;

	/**
	 * The kind of column of the record table that holds the value of the attribute used to filter.
	 */
	public enum FilterAttributeType {
		KEY, SUMMARY
	}

	/**
	 * The attribute chosen by the user together with the value that the exported records must have
	 * for it.
	 */
	public static class FilterAttribute {

		private final AttributeDefinition attributeDefinition;
		private final FilterAttributeType type;
		private final int position;
		private final String value;

		public FilterAttribute(AttributeDefinition attributeDefinition, FilterAttributeType type, int position,
				String value) {
			this.attributeDefinition = attributeDefinition;
			this.type = type;
			this.position = position;
			this.value = value;
		}

		public AttributeDefinition getAttributeDefinition() {
			return attributeDefinition;
		}

		public FilterAttributeType getType() {
			return type;
		}

		public String getValue() {
			return value;
		}

		/**
		 * Returns the values to filter the key attributes by, or null when the user chose a summary
		 * attribute.
		 */
		public List<String> getKeyValues() {
			return type == FilterAttributeType.KEY ? getPositionedValues() : null;
		}

		/**
		 * Returns the values to filter the summary attributes by, or null when the user chose a key
		 * attribute.
		 */
		public List<String> getSummaryValues() {
			return type == FilterAttributeType.SUMMARY ? getPositionedValues() : null;
		}

		/**
		 * Places the chosen value on the column that holds the selected attribute. Blank values are
		 * ignored by the record search, so the positions before the selected one match any value.
		 */
		private List<String> getPositionedValues() {
			List<String> values = new ArrayList<>();
			for (int i = 0; i < position; i++) {
				values.add(""); //$NON-NLS-1$
			}
			values.add(value);
			return values;
		}
	}

	/**
	 * Entry of the attribute combo box, shown to the user with the label of the attribute in the
	 * language of the interface.
	 */
	private static class FilterAttributeItem {

		private final AttributeDefinition attributeDefinition;
		private final FilterAttributeType type;
		private final int position;
		private final String label;

		FilterAttributeItem(AttributeDefinition attributeDefinition, FilterAttributeType type, int position,
				String label) {
			this.attributeDefinition = attributeDefinition;
			this.type = type;
			this.position = position;
			this.label = label;
		}

		AttributeDefinition getAttributeDefinition() {
			return attributeDefinition;
		}

		FilterAttributeType getType() {
			return type;
		}

		int getPosition() {
			return position;
		}

		@Override
		public String toString() {
			return label;
		}
	}

    private final DataFormat exportFormat;
    private JFrame frame;
    private LocalPropertiesService localPropertiesService;
    private DataImportExportService dataExportService;
    private EarthSurveyService earthSurveyService;
    private Logger logger = LoggerFactory.getLogger(ExportActionListener.class);
    private RecordsToExport recordsToExport;
    private KmlGeneratorService kmlGeneratorService;

    public enum RecordsToExport {
		ALL, MODIFIED_SINCE_LAST_EXPORT, PICK_FROM_DATE, USE_SUMMARY_ATTRIBUTE
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
			FilterAttribute filterAttribute = null;

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
			} else if (recordsToExport.equals(RecordsToExport.USE_SUMMARY_ATTRIBUTE)) {
				filterAttribute = getFilterAttributeDlg();
				if (filterAttribute == null) {
					// No attribute value chosen, do not proceed with the export
					return;
				}
            }

			exportDataTo(exportFormat, recordsModifiedSince, filterAttribute);
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

	/**
	 * Asks the user for the attribute and the value that the records to export must have.
	 *
	 * @return the chosen attribute and value, or null if the user cancelled the dialog or the survey
	 *         has no attribute that can be used to filter the records.
	 */
	private FilterAttribute getFilterAttributeDlg() {

		List<FilterAttributeItem> filterableAttributes = getFilterableAttributes();
		if (filterableAttributes.isEmpty()) {
			JOptionPane.showMessageDialog(frame, Messages.getString("ExportActionListener.7"), //$NON-NLS-1$
					Messages.getString("ExportActionListener.3"), //$NON-NLS-1$
					JOptionPane.WARNING_MESSAGE);
			return null;
		}

		JComboBox<FilterAttributeItem> attributes = new JComboBox<>(
				filterableAttributes.toArray(new FilterAttributeItem[filterableAttributes.size()]));
		JTextField attributeValue = new JTextField(20);

		JPanel panel = new JPanel(new GridBagLayout());
		GridBagConstraints constraints = new GridBagConstraints();
		constraints.anchor = GridBagConstraints.LINE_START;
		constraints.fill = GridBagConstraints.HORIZONTAL;
		constraints.insets = new Insets(5, 5, 5, 5);

		constraints.gridx = 0;
		constraints.gridy = 0;
		panel.add(new JLabel(Messages.getString("ExportActionListener.4")), constraints); //$NON-NLS-1$
		constraints.gridx = 1;
		panel.add(attributes, constraints);

		constraints.gridx = 0;
		constraints.gridy = 1;
		panel.add(new JLabel(Messages.getString("ExportActionListener.5")), constraints); //$NON-NLS-1$
		constraints.gridx = 1;
		panel.add(attributeValue, constraints);

		constraints.gridx = 0;
		constraints.gridy = 2;
		constraints.gridwidth = 2;
		panel.add(new JLabel(Messages.getString("ExportActionListener.6")), constraints); //$NON-NLS-1$

		int result = JOptionPane.showConfirmDialog(frame, panel, Messages.getString("ExportActionListener.3"), //$NON-NLS-1$
				JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
		if (result != JOptionPane.OK_OPTION) {
			return null;
		}

		String value = attributeValue.getText();
		if (StringUtils.isBlank(value)) {
			// Without a value every record would be exported, which is not what this option is for
			JOptionPane.showMessageDialog(frame, Messages.getString("ExportActionListener.8"), //$NON-NLS-1$
					Messages.getString("ExportActionListener.3"), //$NON-NLS-1$
					JOptionPane.WARNING_MESSAGE);
			return null;
		}

		FilterAttributeItem selectedAttribute = (FilterAttributeItem) attributes.getSelectedItem();
		return new FilterAttribute(selectedAttribute.getAttributeDefinition(), selectedAttribute.getType(),
				selectedAttribute.getPosition(), value.trim());
	}

	/**
	 * Returns the key and the summary attributes of the survey that can be used to filter the
	 * records, in the same order that Collect uses to store them in the key and summary columns of
	 * the record table.
	 */
	private List<FilterAttributeItem> getFilterableAttributes() {

		List<FilterAttributeItem> filterableAttributes = new ArrayList<>();

		// Use the same root entity that the export uses, so that the position of every attribute
		// matches the column where its value is stored
		EntityDefinition rootEntity = earthSurveyService.getRootEntityDefinition();

		addFilterableAttributes(filterableAttributes, rootEntity.getKeyAttributeDefinitions(),
				FilterAttributeType.KEY, Messages.getString("ExportActionListener.9")); //$NON-NLS-1$

		addFilterableAttributes(filterableAttributes,
				earthSurveyService.getCollectSurvey().getSchema().getSummaryAttributeDefinitions(rootEntity),
				FilterAttributeType.SUMMARY, Messages.getString("ExportActionListener.10")); //$NON-NLS-1$

		return filterableAttributes;
	}

	private void addFilterableAttributes(List<FilterAttributeItem> filterableAttributes,
			List<AttributeDefinition> attributeDefinitions, FilterAttributeType type, String typeLabel) {

		if (attributeDefinitions == null) {
			return;
		}

		String language = localPropertiesService.getUiLanguage().getLocale().getLanguage();
		for (int position = 0; position < attributeDefinitions.size()
				&& position < MAX_FILTERABLE_ATTRIBUTES; position++) {
			AttributeDefinition attributeDefinition = attributeDefinitions.get(position);
			String label = attributeDefinition.getFailSafeLabel(language) + " (" + typeLabel + ")"; //$NON-NLS-1$ //$NON-NLS-2$
			filterableAttributes.add(new FilterAttributeItem(attributeDefinition, type, position, label));
		}

		if (attributeDefinitions.size() > MAX_FILTERABLE_ATTRIBUTES) {
			logger.warn(
					"The survey defines {} {} attributes but only the first {} can be used to filter the records to export", //$NON-NLS-1$
					attributeDefinitions.size(), type, MAX_FILTERABLE_ATTRIBUTES);
		}
	}

	private File exportDataTo(DataFormat exportType, Date recordsModifiedSince, FilterAttribute filterAttribute) {
        // Informational warning for CSV exports
        if (exportType.equals(DataFormat.CSV)) {
            // Warn the user that CSV is for visualization but not shareable across Collect Earth instances
            JOptionPane.showMessageDialog(frame,
            		Messages.getString("ExportActionListener.2"), // $NON-NLS-1$
                "Information",
                JOptionPane.INFORMATION_MESSAGE);
        }

		String preselectedName = getPreselectedName(exportType, recordsModifiedSince, filterAttribute);

        File[] exportToFile = FileChooserUtils.getFileChooserResults(exportType, true, false, preselectedName,
                localPropertiesService, frame);

        File exportedFile = null;
        if (exportToFile != null && exportToFile.length > 0) {
			startExportingData(exportType, recordsModifiedSince, exportToFile[0], filterAttribute);
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

	private void startExportingData(DataFormat exportType, Date recordsModifiedSince, File exportToFile, FilterAttribute filterAttribute) {
        AbstractProcess<Void, DataExportStatus> exportProcess = null;
        try {
			exportProcess = getExportProcess(exportType, recordsModifiedSince, exportToFile, filterAttribute);
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
			File exportToFile, FilterAttribute filterAttribute) throws Exception {
        AbstractProcess<Void, DataExportStatus> exportProcess = null;
        boolean addLabels = false;
        switch (exportType) {
        case CSV:
            addLabels = promptForLabelInclusion(exportType);
            exportProcess = dataExportService.exportSurveyAsCsv(exportToFile, addLabels);
            break;
        case ZIP_WITH_XML:
			exportProcess = dataExportService.exportSurveyAsZipWithXml(exportToFile, recordsModifiedSince,
					filterAttribute == null ? null : filterAttribute.getKeyValues(),
					filterAttribute == null ? null : filterAttribute.getSummaryValues());
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

	private String getPreselectedName(DataFormat exportType, Date modifiedSince, FilterAttribute filterAttribute) {

        String operator = "";

        try {
			operator = toFileNameSafe(localPropertiesService.getOperator());
        } catch (Exception e) {
            logger.error("Error normalizing operator name ", e);
        }

        String preselectName = operator + "_collectedData_"; //$NON-NLS-1$

        preselectName += earthSurveyService.getCollectSurvey().getName();

		if (filterAttribute != null) {
			// Make the exports of the different attribute values distinguishable from each other
			preselectName += "_" + toFileNameSafe(filterAttribute.getAttributeDefinition().getName()) //$NON-NLS-1$
					+ "_" + toFileNameSafe(filterAttribute.getValue()); //$NON-NLS-1$
		}

        DateFormat dateFormat = new SimpleDateFormat("ddMMyy_HHmmss"); //$NON-NLS-1$
        if (modifiedSince == null) {
            preselectName += "_on_" + dateFormat.format(new Date()); //$NON-NLS-1$
        } else {

            preselectName += "_" + dateFormat.format(modifiedSince) + "_to_" + dateFormat.format(new Date()); //$NON-NLS-1$ //$NON-NLS-2$
        }

        preselectName += "_" + exportType.name() + "." + exportType.getDefaultExtension(); //$NON-NLS-1$ //$NON-NLS-2$

        return preselectName;
    }

	/**
	 * Removes the accents and the characters that cannot be used in a file name, so that a text like
	 * "This is a funky String" can safely be used as part of the name of the exported file.
	 */
	private String toFileNameSafe(String text) {
		if (text == null) {
			return ""; //$NON-NLS-1$
		}
		String fileName = StringUtils.deleteWhitespace(text);
		fileName = Normalizer.normalize(fileName, Normalizer.Form.NFD).replaceAll("[^\\p{ASCII}]", ""); //$NON-NLS-1$ //$NON-NLS-2$
		return fileName.replaceAll("[^a-zA-Z0-9]", ""); //$NON-NLS-1$ //$NON-NLS-2$
	}
}
