package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.Toolkit;
import java.util.HashMap;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.ScrollPaneConstants;

import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.view.properties.BrowserDisplayPanel;
import org.openforis.collect.earth.app.view.properties.DatabaseServerPanel;
import org.openforis.collect.earth.app.view.properties.ExternalServicesPanel;
import org.openforis.collect.earth.app.view.properties.PlotOptionsPanel;
import org.openforis.collect.earth.app.view.properties.ProjectsPanel;
import org.openforis.collect.earth.app.view.properties.SampleDataPanel;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Dialog for configuring various application properties.
 *
 * This class coordinates the individual property panels and handles
 * applying changes to the application configuration.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class PropertiesDialog extends JDialog {

    private static final long serialVersionUID = -6760020609229102842L;

    private final transient Logger logger = LoggerFactory.getLogger(this.getClass());

    // Shared data structures for property management
    private final HashMap<Enum<?>, JComponent[]> propertyToComponent = new HashMap<>();
    private final HashMap<JComponent, JLabel> componentToRowLabel = new HashMap<>();

    // Services
    private final transient LocalPropertiesService localPropertiesService;
    private final transient AnalysisSaikuService saikuService;
    private final transient EarthProjectsService projectsService;

    // Configuration
    private final String backupFolder;
    private final CollectSurvey surveyLoaded;

    // State
    private boolean restartRequired;

    // UI Components
    private JButton applyChanges;
    private SampleDataPanel sampleDataPanel;
    private PlotOptionsPanel plotOptionsPanel;
    private ExternalServicesPanel externalServicesPanel;
    private DatabaseServerPanel databaseServerPanel;
    private BrowserDisplayPanel browserDisplayPanel;
    private ProjectsPanel projectsPanel;

    /**
     * Constructor for PropertiesDialog.
     */
    public PropertiesDialog(JFrame frame, LocalPropertiesService localPropertiesService,
                            EarthProjectsService projectsService, String backupFolder,
                            AnalysisSaikuService saikuService, CollectSurvey surveyLoaded) {
        super(frame, Messages.getString("OptionWizard.0"));
        this.localPropertiesService = localPropertiesService;
        this.projectsService = projectsService;
        this.backupFolder = backupFolder;
        this.saikuService = saikuService;
        this.surveyLoaded = surveyLoaded;

        initializeDialog();
    }

    /**
     * Initialize the dialog properties and build the UI.
     */
    private void initializeDialog() {
        setLocationRelativeTo(null);
        setMinimumSize(new Dimension(700, 650));
        setPreferredSize(new Dimension(800, 700));
        setSize(new Dimension(800, 700));
        setModal(true);
        setResizable(true);

        try {
            logger.info("Starting PropertiesDialog initialization...");
            initializePanels();
            logger.info("Panels initialized successfully");
            buildMainPane();
            logger.info("Main pane built successfully");
            centerWindow();
            logger.info("PropertiesDialog initialization completed");
        } catch (Exception e) {
            logger.error("Error initializing properties dialog", e);
            throw new RuntimeException("Failed to initialize Properties Dialog: " + e.getMessage(), e);
        }
    }

    /**
     * Initialize all property panels.
     */
    private void initializePanels() {
        // Sample Data Panel
        sampleDataPanel = new SampleDataPanel(
                localPropertiesService, surveyLoaded,
                propertyToComponent, componentToRowLabel);
        sampleDataPanel.setApplyButtonEnabler(() ->
                getApplyChangesButton().setEnabled(sampleDataPanel.isDataValid()));

        // Plot Options Panel
        plotOptionsPanel = new PlotOptionsPanel(
                localPropertiesService, propertyToComponent, componentToRowLabel);

        // External Services Panel
        externalServicesPanel = new ExternalServicesPanel(
                localPropertiesService, propertyToComponent, componentToRowLabel);

        // Database Server Panel
        databaseServerPanel = new DatabaseServerPanel(
                localPropertiesService, propertyToComponent, componentToRowLabel, backupFolder);
        databaseServerPanel.setRestartRequiredCallback(() -> setRestartRequired(true));

        // Browser Display Panel
        browserDisplayPanel = new BrowserDisplayPanel(
                localPropertiesService, propertyToComponent, componentToRowLabel, saikuService);
        browserDisplayPanel.setRestartRequiredCallback(() -> setRestartRequired(true));

        // Projects Panel
        projectsPanel = new ProjectsPanel(
                localPropertiesService, propertyToComponent, componentToRowLabel, projectsService);
        projectsPanel.setOnProjectImport(this::restartEarth);
        projectsPanel.setOnProjectLoad(this::restartEarth);
    }

    /**
     * Center the window on the screen.
     */
    private void centerWindow() {
        Dimension dimension = Toolkit.getDefaultToolkit().getScreenSize();
        int x = (int) ((dimension.getWidth() - getWidth()) / 2);
        int y = (int) ((dimension.getHeight() - getHeight()) / 2);
        setLocation(x, y);
    }

    /**
     * Build the main panel with tabs and buttons.
     */
    private void buildMainPane() {
        JPanel panel = new JPanel(new BorderLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(10, 10, 10, 10));

        // Add tabbed pane
        JTabbedPane tabs = createTabbedPane();
        tabs.setBorder(BorderFactory.createEmptyBorder(5, 5, 5, 5));
        panel.add(tabs, BorderLayout.CENTER);

        // Button panel
        JPanel buttonPanel = new JPanel();
        buttonPanel.setBorder(BorderFactory.createEmptyBorder(10, 0, 0, 0));
        buttonPanel.add(getApplyChangesButton());
        buttonPanel.add(Box.createHorizontalStrut(10));
        buttonPanel.add(getCancelButton());
        panel.add(buttonPanel, BorderLayout.PAGE_END);

        add(panel);
    }

    /**
     * Create the tabbed pane with all option panels.
     */
    private JTabbedPane createTabbedPane() {
        JTabbedPane tabbedPane = new JTabbedPane();
        tabbedPane.setPreferredSize(new Dimension(750, 550));

        // Add tabs
        tabbedPane.addTab(Messages.getString("OptionWizard.31"), sampleDataPanel);
        tabbedPane.addTab(Messages.getString("OptionWizard.32"), plotOptionsPanel);
        tabbedPane.addTab(Messages.getString("OptionWizard.125"), externalServicesPanel);
        tabbedPane.addTab(Messages.getString("OptionWizard.126"), databaseServerPanel);
        tabbedPane.addTab(Messages.getString("OptionWizard.127"), browserDisplayPanel);
        tabbedPane.addTab(Messages.getString("OptionWizard.40"),
                new JScrollPane(projectsPanel,
                        ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                        ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER));

        return tabbedPane;
    }

    /**
     * Creates the Apply Changes button.
     */
    private JButton getApplyChangesButton() {
        if (applyChanges == null) {
            applyChanges = new JButton(Messages.getString("OptionWizard.15"));
            applyChanges.addActionListener(
                    new ApplyOptionChangesListener(this, localPropertiesService, propertyToComponent) {
                        @Override
                        protected void applyProperties() {
                            applyChanges.setText("Applying Changes...");
                            applyChanges.setEnabled(false);
                            setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.WAIT_CURSOR));

                            new Thread("Applying properties dialog") {
                                @Override
                                public void run() {
                                    try {
                                        if (validateAllFields()) {
                                            savePropertyValues();

                                            javax.swing.SwingUtilities.invokeLater(() -> {
                                                if (isRestartRequired()) {
                                                    restartEarth();
                                                } else {
                                                    EarthApp.executeKmlLoadAsynchronously(PropertiesDialog.this);
                                                }
                                                showSuccessMessage();
                                                closeDialog();
                                            });
                                        } else {
                                            javax.swing.SwingUtilities.invokeLater(
                                                    PropertiesDialog.this::showValidationErrorMessage);
                                        }
                                    } catch (Exception e) {
                                        javax.swing.SwingUtilities.invokeLater(() -> showErrorMessage(e));
                                    } finally {
                                        javax.swing.SwingUtilities.invokeLater(() -> {
                                            applyChanges.setText(Messages.getString("OptionWizard.15"));
                                            applyChanges.setEnabled(true);
                                            setCursor(java.awt.Cursor.getDefaultCursor());
                                        });
                                    }
                                }
                            }.start();
                        }
                    });
        }
        return applyChanges;
    }

    /**
     * Validates all fields in all panels.
     */
    private boolean validateAllFields() {
        for (JComponent[] comps : propertyToComponent.values()) {
            if (comps != null && comps.length > 0) {
                JComponent comp = comps[0];
                if (!comp.isVisible() || !comp.isEnabled()) {
                    continue;
                }
                javax.swing.InputVerifier verifier = comp.getInputVerifier();
                if (verifier != null && !verifier.verify(comp)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Shows a success message when properties are applied successfully.
     */
    private void showSuccessMessage() {
        String message = "Settings have been applied successfully.";
        if (isRestartRequired()) {
            message += "\n\nThe application will restart to apply some changes.";
        }
        JOptionPane.showMessageDialog(this, message,
                "Settings Applied", JOptionPane.INFORMATION_MESSAGE);
    }

    /**
     * Shows an error message when validation fails.
     */
    private void showValidationErrorMessage() {
        JOptionPane.showMessageDialog(this,
                "Please correct the validation errors before applying changes.\n\n" +
                        "Look for fields highlighted in red and check their tooltips for guidance.",
                "Validation Error", JOptionPane.WARNING_MESSAGE);
    }

    /**
     * Shows an error message when an exception occurs.
     */
    private void showErrorMessage(Exception e) {
        String userMessage = "An error occurred while applying settings.";
        String technicalDetails = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();

        JOptionPane.showMessageDialog(this,
                userMessage + "\n\nTechnical details: " + technicalDetails +
                        "\n\nPlease check your settings and try again.",
                "Error Applying Settings", JOptionPane.ERROR_MESSAGE);

        logger.error("Error applying properties", e);
    }

    /**
     * Close the dialog.
     */
    public void closeDialog() {
        dispose();
    }

    /**
     * Creates the Cancel button.
     */
    private JButton getCancelButton() {
        JButton cancelButton = new JButton(Messages.getString("OptionWizard.24"));
        cancelButton.addActionListener(e -> dispose());
        return cancelButton;
    }

    /**
     * Restart the Earth application.
     */
    private void restartEarth() {
        new ApplyOptionChangesListener(this, localPropertiesService, propertyToComponent) {
            @Override
            protected void applyProperties() {
                super.restartEarth();
            }
        }.actionPerformed(null);
    }

    /**
     * Check if restart is required after applying changes.
     */
    public boolean isRestartRequired() {
        return restartRequired;
    }

    /**
     * Set restart required flag.
     */
    public void setRestartRequired(boolean restartRequired) {
        this.restartRequired = restartRequired;
    }

    /**
     * Gets the property-to-component mapping.
     */
    public HashMap<Enum<?>, JComponent[]> getPropertyToComponent() {
        return propertyToComponent;
    }
}
