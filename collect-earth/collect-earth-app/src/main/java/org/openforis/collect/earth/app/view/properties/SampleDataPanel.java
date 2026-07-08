package org.openforis.collect.earth.app.view.properties;

import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.io.File;
import java.util.HashMap;
import java.util.List;

import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.ScrollPaneConstants;
import javax.swing.SwingWorker;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient;
import org.openforis.collect.earth.app.service.cloud.CloudApiClient.AssignmentInfo;
import org.openforis.collect.earth.app.view.JFilePicker;
import org.openforis.collect.earth.app.view.JFilePicker.DlgMode;
import org.openforis.collect.earth.app.view.JPlotCsvTable;
import org.openforis.collect.earth.app.view.Messages;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Panel for configuring sample data file and displaying plot information.
 *
 * <p>In cloud mode the plot CSV is not chosen but assigned by the server: a
 * read-only combo of the operator's assigned CSVs replaces the free choice, the
 * file picker stays visible but disabled (disabled components are still saved, so
 * {@code SAMPLE_FILE} persists), and selecting a CSV downloads it locally and
 * points the picker at it — reusing the picker's existing document-listener chain
 * to refresh the preview and Apply button exactly as a manual pick would.</p>
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class SampleDataPanel extends AbstractPropertyPanel {

    private static final long serialVersionUID = 1L;

    private final transient Logger logger = LoggerFactory.getLogger(SampleDataPanel.class);

    private final CollectSurvey surveyLoaded;
    private final transient CloudApiClient cloudApiClient;
    private JPlotCsvTable samplePlots;
    private JFilePicker filePicker;
    private Runnable applyButtonEnabler;

    private JComboBox<AssignmentItem> assignmentCombo;
    private JButton refreshAssignmentsButton;

    public SampleDataPanel(LocalPropertiesService localPropertiesService,
                           CollectSurvey surveyLoaded,
                           HashMap<Enum<?>, JComponent[]> propertyToComponent,
                           HashMap<JComponent, JLabel> componentToRowLabel,
                           CloudApiClient cloudApiClient) {
        super(localPropertiesService, propertyToComponent, componentToRowLabel);
        this.surveyLoaded = surveyLoaded;
        this.cloudApiClient = cloudApiClient;
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
        samplePlots = new JPlotCsvTable(
                localPropertiesService.getValue(EarthProperty.SAMPLE_FILE),
                surveyLoaded
        );

        filePicker = createFilePickerWithListener();
        registerComponent(EarthProperty.SAMPLE_FILE, filePicker);

        boolean cloud = localPropertiesService.isCloudSyncEnabled();
        int row = 0;

        if (cloud) {
            // The CSV is assigned by the server: show the assignment row and keep the
            // picker visible but disabled (visible so it is still saved on Apply).
            add(createAssignmentRow(), new GridBagConstraintsBuilder()
                    .gridx(0).gridy(row++).weightx(1.0).fill(GridBagConstraints.HORIZONTAL).build());
            filePicker.setEnabled(false);
        }

        add(filePicker, new GridBagConstraintsBuilder()
                .gridx(0).gridy(row++).weightx(1.0).fill(GridBagConstraints.HORIZONTAL).build());

        samplePlots.setFillsViewportHeight(true);
        JScrollPane scrollPane = new JScrollPane(samplePlots,
                ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED);
        scrollPane.setPreferredSize(new Dimension(600, 400));
        scrollPane.setMinimumSize(new Dimension(500, 300));

        add(scrollPane, new GridBagConstraintsBuilder()
                .gridx(0).gridy(row).weightx(1.0).weighty(1.0)
                .gridwidth(GridBagConstraints.REMAINDER).gridheight(GridBagConstraints.REMAINDER)
                .fill(GridBagConstraints.BOTH).build());

        if (cloud) {
            loadAssignmentsAsync();
        }
    }

    /** Builds the "assigned by server" row: assignment combo + refresh button + hint. */
    private JPanel createAssignmentRow() {
        JPanel row = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        row.add(new JLabel(Messages.getString("SampleDataPanel.assignmentLabel"))); //$NON-NLS-1$

        assignmentCombo = new JComboBox<>();
        assignmentCombo.setPrototypeDisplayValue(new AssignmentItem(null));
        assignmentCombo.addActionListener(e -> onAssignmentSelected());
        row.add(assignmentCombo);

        refreshAssignmentsButton = new JButton(Messages.getString("SampleDataPanel.refreshAssignments")); //$NON-NLS-1$
        refreshAssignmentsButton.addActionListener(e -> loadAssignmentsAsync());
        row.add(refreshAssignmentsButton);

        String server = localPropertiesService.getCloudSyncUrl();
        row.add(new JLabel(String.format(Messages.getString("SampleDataPanel.assignedBy"), //$NON-NLS-1$
                server == null ? "" : server)));

        return row;
    }

    /** Fetches the operator's assignments from the server on a background thread. */
    private void loadAssignmentsAsync() {
        if (assignmentCombo == null) {
            return;
        }
        refreshAssignmentsButton.setEnabled(false);
        new SwingWorker<List<AssignmentInfo>, Void>() {
            @Override
            protected List<AssignmentInfo> doInBackground() throws Exception {
                return cloudApiClient.getMyAssignments();
            }

            @Override
            protected void done() {
                try {
                    populateAssignments(get());
                } catch (Exception ex) {
                    logger.warn("Could not load cloud assignments: {}", ex.getMessage());
                    JOptionPane.showMessageDialog(SampleDataPanel.this,
                            Messages.getString("SampleDataPanel.assignmentsError"), //$NON-NLS-1$
                            Messages.getString("SampleDataPanel.assignmentLabel"), JOptionPane.WARNING_MESSAGE); //$NON-NLS-1$
                } finally {
                    refreshAssignmentsButton.setEnabled(true);
                }
            }
        }.execute();
    }

    private void populateAssignments(List<AssignmentInfo> assignments) {
        String currentPath = filePicker.getSelectedFilePath();
        assignmentCombo.removeAllItems();
        AssignmentItem toSelect = null;
        for (AssignmentInfo info : assignments) {
            AssignmentItem item = new AssignmentItem(info);
            assignmentCombo.addItem(item);
            // Keep the currently active CSV selected if it is still assigned.
            if (currentPath != null && currentPath.endsWith(info.getFilename())) {
                toSelect = item;
            }
        }
        if (toSelect != null) {
            assignmentCombo.setSelectedItem(toSelect);
        } else if (assignmentCombo.getItemCount() > 0) {
            assignmentCombo.setSelectedIndex(0);
        }
    }

    /** Downloads the selected assigned CSV (if needed) and points the picker at it. */
    private void onAssignmentSelected() {
        final AssignmentItem item = (AssignmentItem) assignmentCombo.getSelectedItem();
        if (item == null || item.info == null) {
            return;
        }
        refreshAssignmentsButton.setEnabled(false);
        new SwingWorker<File, Void>() {
            @Override
            protected File doInBackground() throws Exception {
                return cloudApiClient.downloadAssignedCsv(item.info, getAssignmentsFolder());
            }

            @Override
            protected void done() {
                try {
                    File csv = get();
                    // Setting the picker text fires its DocumentListener -> refreshTable().
                    filePicker.getTextField().setText(csv.getAbsolutePath());
                } catch (Exception ex) {
                    logger.warn("Could not download assigned CSV: {}", ex.getMessage());
                    JOptionPane.showMessageDialog(SampleDataPanel.this,
                            Messages.getString("SampleDataPanel.downloadError"), //$NON-NLS-1$
                            Messages.getString("SampleDataPanel.assignmentLabel"), JOptionPane.WARNING_MESSAGE); //$NON-NLS-1$
                } finally {
                    refreshAssignmentsButton.setEnabled(true);
                }
            }
        }.execute();
    }

    /** {@code <projectFolder>/assignments} — a stable local home for downloaded CSVs. */
    private File getAssignmentsFolder() {
        File idm = new File(localPropertiesService.getImdFile()).getAbsoluteFile();
        File parent = idm.getParentFile();
        return new File(parent, "assignments");
    }

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

    /** Combo entry wrapping an assignment; its label is the CSV filename and plot count. */
    private static class AssignmentItem {
        private final AssignmentInfo info;

        AssignmentItem(AssignmentInfo info) {
            this.info = info;
        }

        @Override
        public String toString() {
            if (info == null) {
                return "";
            }
            return info.getPlotCount() > 0 ? info.getFilename() + " (" + info.getPlotCount() + ")"
                    : info.getFilename();
        }
    }
}
