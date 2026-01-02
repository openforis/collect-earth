package org.openforis.collect.earth.app.view.properties;

import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.util.HashMap;

import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JScrollPane;
import javax.swing.ScrollPaneConstants;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.JFilePicker;
import org.openforis.collect.earth.app.view.JFilePicker.DlgMode;
import org.openforis.collect.earth.app.view.JPlotCsvTable;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.model.CollectSurvey;

/**
 * Panel for configuring sample data file and displaying plot information.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class SampleDataPanel extends AbstractPropertyPanel {

    private static final long serialVersionUID = 1L;

    private final CollectSurvey surveyLoaded;
    private JPlotCsvTable samplePlots;
    private JFilePicker filePicker;
    private Runnable applyButtonEnabler;

    /**
     * Creates a new sample data panel.
     *
     * @param localPropertiesService Properties service
     * @param surveyLoaded           Currently loaded survey
     * @param propertyToComponent    Shared property-component mapping
     * @param componentToRowLabel    Shared component-label mapping
     */
    public SampleDataPanel(LocalPropertiesService localPropertiesService,
                           CollectSurvey surveyLoaded,
                           HashMap<Enum<?>, JComponent[]> propertyToComponent,
                           HashMap<JComponent, JLabel> componentToRowLabel) {
        super(localPropertiesService, propertyToComponent, componentToRowLabel);
        this.surveyLoaded = surveyLoaded;
        buildPanel();
    }

    /**
     * Sets the callback for enabling/disabling the apply button based on data validity.
     */
    public void setApplyButtonEnabler(Runnable enabler) {
        this.applyButtonEnabler = enabler;
    }

    @Override
    protected void buildPanel() {
        // Create the sample plots table
        samplePlots = new JPlotCsvTable(
                localPropertiesService.getValue(EarthProperty.SAMPLE_FILE),
                surveyLoaded
        );

        // Create file picker for sample plots CSV
        filePicker = createFilePickerWithListener();
        registerComponent(EarthProperty.SAMPLE_FILE, filePicker);

        // Add file picker
        GridBagConstraints filePickerConstraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(0)
                .weightx(1.0)
                .fill(GridBagConstraints.HORIZONTAL)
                .build();
        add(filePicker, filePickerConstraints);

        // Add sample plots table in scroll pane
        samplePlots.setFillsViewportHeight(true);

        JScrollPane scrollPane = new JScrollPane(samplePlots,
                ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED);
        scrollPane.setPreferredSize(new Dimension(600, 400));
        scrollPane.setMinimumSize(new Dimension(500, 300));

        GridBagConstraints tableConstraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(1)
                .weightx(1.0)
                .weighty(1.0)
                .gridwidth(GridBagConstraints.REMAINDER)
                .gridheight(GridBagConstraints.REMAINDER)
                .fill(GridBagConstraints.BOTH)
                .build();
        add(scrollPane, tableConstraints);
    }

    /**
     * Creates the file picker with a document listener for table refresh.
     */
    private JFilePicker createFilePickerWithListener() {
        JFilePicker picker = new JFilePicker(
                Messages.getString("OptionWizard.49"),
                localPropertiesService.getValue(EarthProperty.SAMPLE_FILE),
                Messages.getString("OptionWizard.50"),
                DlgMode.MODE_OPEN
        );
        picker.addFileTypeFilter(".csv,.ced", Messages.getString("OptionWizard.52"), true);

        picker.addChangeListener(new DocumentListener() {
            @Override
            public void changedUpdate(DocumentEvent e) {
                // Not used for plain text documents
            }

            @Override
            public void insertUpdate(DocumentEvent e) {
                refreshTable();
            }

            @Override
            public void removeUpdate(DocumentEvent e) {
                // Not used
            }

            private void refreshTable() {
                samplePlots.refreshTable(picker.getSelectedFilePath());
                // Update apply button state based on data validity
                if (applyButtonEnabler != null) {
                    applyButtonEnabler.run();
                }
            }
        });

        return picker;
    }

    /**
     * Checks if the sample data is valid.
     */
    public boolean isDataValid() {
        return samplePlots != null && samplePlots.isDataValid();
    }

    /**
     * Gets the file picker component.
     */
    public JFilePicker getFilePicker() {
        return filePicker;
    }

    /**
     * Gets the sample plots table.
     */
    public JPlotCsvTable getSamplePlotsTable() {
        return samplePlots;
    }
}
