package org.openforis.collect.earth.app.view;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Container;
import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.GridLayout;
import java.awt.Insets;
import java.awt.Toolkit;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.text.DecimalFormat;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;

import javax.swing.AbstractAction;
import javax.swing.AbstractButton;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.ButtonGroup;
import javax.swing.InputVerifier;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JRadioButton;
import javax.swing.JScrollPane;
import javax.swing.JSpinner;
import javax.swing.JTabbedPane;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import javax.swing.ScrollPaneConstants;
import javax.swing.SpinnerNumberModel;
import javax.swing.UIManager;
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

import org.apache.commons.lang3.StringUtils;
import org.jdesktop.swingx.JXDatePicker;
import org.jdesktop.swingx.plaf.basic.CalendarHeaderHandler;
import org.jdesktop.swingx.plaf.basic.SpinningCalendarHeaderHandler;
import org.jdesktop.swingx.prompt.PromptSupport;
import org.openforis.collect.earth.app.CollectEarthUtils;
import org.openforis.collect.earth.app.EarthConstants;
import org.openforis.collect.earth.app.EarthConstants.CollectDBDriver;
import org.openforis.collect.earth.app.EarthConstants.OperationMode;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.desktop.EarthApp;
import org.openforis.collect.earth.app.service.AnalysisSaikuService;
import org.openforis.collect.earth.app.service.EarthProjectsService;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.JFilePicker.DlgMode;
import org.openforis.collect.model.CollectSurvey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Dialog for configuring various application properties.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 */
public class PropertiesDialog extends JDialog {

    private static final String START_OF_LANDSAT_AND_MODIS = "2000-01-01";
    private static final ComboBoxItem COMBO_BOX_ITEM_CENTRAL_POINT = new ComboBoxItem(1, Messages.getString("OptionWizard.54"));
    private static final ComboBoxItem COMBO_BOX_ITEM_SQUARE = new ComboBoxItem(0, Messages.getString("OptionWizard.53"));
    private static final long serialVersionUID = -6760020609229102842L;

    // Main data structures
	private final HashMap<Enum<?>, JComponent[]> propertyToComponent = new HashMap<>();
	private final HashMap<JComponent, JLabel> componentToRowLabel = new HashMap<>();
    private final transient Logger logger = LoggerFactory.getLogger(this.getClass());
    
    // UI panels
    private JPanel postgresPanel;
    private JPanel sqlitePanel;
    private JButton applyChanges;
    
    // Services
    private transient LocalPropertiesService localPropertiesService;
    private transient AnalysisSaikuService saikuService;
    private transient EarthProjectsService projectsService;
    
    // State
    private String backupFolder;
    private boolean restartRequired;
    private String oldSelectedDistance;
    private CollectSurvey surveyLoaded;

    /**
     * Constructor for PropertiesDialog.
     */
    public PropertiesDialog(JFrame frame, LocalPropertiesService localPropertiesService,
            EarthProjectsService projectsService, String backupFolder, AnalysisSaikuService saikuService,
            CollectSurvey surveyLoaded) {
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
        this.setLocationRelativeTo(null);
        this.setMinimumSize(new Dimension(700, 650));
        this.setPreferredSize(new Dimension(800, 700));
        this.setSize(new Dimension(800, 700));
        this.setModal(true);
        this.setResizable(true);

        try {
            logger.info("Starting PropertiesDialog initialization...");
            initializeInputs();
            logger.info("Inputs initialized successfully");
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
        final JPanel panel = new JPanel(new BorderLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(10, 10, 10, 10));
        
        // Make tabs expandable
        JTabbedPane tabs = getOptionTabs();
        tabs.setBorder(BorderFactory.createEmptyBorder(5, 5, 5, 5));
        panel.add(tabs, BorderLayout.CENTER);
        
        // Button panel with proper spacing
        final JPanel buttonPanel = new JPanel();
        buttonPanel.setBorder(BorderFactory.createEmptyBorder(10, 0, 0, 0));
        buttonPanel.add(getApplyChangesButton());
        buttonPanel.add(Box.createHorizontalStrut(10)); // Add spacing between buttons
        buttonPanel.add(getCancelButton());
        panel.add(buttonPanel, BorderLayout.PAGE_END);
        
        this.add(panel);
    }

    /**
     * Create the tabbed pane with all option panels.
     */
    private JTabbedPane getOptionTabs() {
        final JTabbedPane tabbedPane = new JTabbedPane();
        // Remove fixed size to allow responsive behavior
        tabbedPane.setPreferredSize(new Dimension(750, 550));
        
        // Add tabs with better logical grouping
        tabbedPane.addTab(Messages.getString("OptionWizard.31"), getSampleDataPanel()); // Sample Data
        tabbedPane.addTab(Messages.getString("OptionWizard.32"), getPlotOptionsPanel()); // Plot Configuration
        tabbedPane.addTab(Messages.getString("OptionWizard.125"), getExternalServicesPanel()); // Combined external services
        tabbedPane.addTab(Messages.getString("OptionWizard.126"), getDatabaseServerPanel()); // Combined DB and server settings
        tabbedPane.addTab(Messages.getString("OptionWizard.127"), getBrowserDisplayPanel()); // Browser and display options
        tabbedPane.addTab(Messages.getString("OptionWizard.40"), getProjectsPanelScroll()); // Project Management

        return tabbedPane;
    }

    /**
     * Enable or disable all components in a container recursively.
     */
    private void enableContainer(Container container, boolean enable) {
        final Component[] components = container.getComponents();
        for (final Component component : components) {
            component.setEnabled(enable);
            if (component instanceof Container) {
                enableContainer((Container) component, enable);
            }
        }
    }

    /**
     * Creates the browser options panel.
     */
    private JComponent getBrowsersOptionsPanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();

        // Browser chooser panel
        final JPanel browserChooserPanel = createBrowserChooserPanel();
        constraints.gridy++;
        panel.add(browserChooserPanel, constraints);

        // Saiku server folder
        constraints.gridy++;
        panel.add(propertyToComponent.get(EarthProperty.SAIKU_SERVER_FOLDER)[0], constraints);

        return panel;
    }
    
    /**
     * Creates the browser chooser panel with radio buttons.
     */
    private JPanel createBrowserChooserPanel() {
        final JPanel browserChooserPanel = new JPanel();
        final Border browserBorder = new TitledBorder(new BevelBorder(BevelBorder.LOWERED),
                Messages.getString("OptionWizard.1"));
        browserChooserPanel.setBorder(browserBorder);
        browserChooserPanel.setLayout(new GridLayout(0, 1));

        final ButtonGroup browserChooser = new ButtonGroup();
        final JComponent[] browsers = propertyToComponent.get(EarthProperty.BROWSER_TO_USE);

        for (final JComponent browserRadioButton : browsers) {
            browserChooserPanel.add(browserRadioButton);
            browserChooser.add((AbstractButton) browserRadioButton);
            ((JRadioButton) browserRadioButton).addActionListener(e -> setRestartRequired(true));
        }
        
        return browserChooserPanel;
    }

    /**
     * Creates the integrations panel.
     */
    private JComponent getIntegrationsPanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();

        // Google Earth Engine App
        panel.add(propertyToComponent.get(EarthProperty.OPEN_GEE_APP)[0], constraints);
        constraints.gridx = 1;
        JPanel panelGeeApp = getGeeAppOptionsPanel(panel, constraints);

        // Add GEE App options panel
        constraints.gridx = 0;
        constraints.gridy++;
        constraints.gridwidth = 4;
        panel.add(panelGeeApp, constraints);
        
        // Earth Map
        constraints.gridy++;
        constraints.gridwidth = 1;
        panel.add(propertyToComponent.get(EarthProperty.OPEN_EARTH_MAP)[0], constraints);

        // Planet Maps
        constraints.gridy++;
        constraints.gridwidth = 1;
        panel.add(propertyToComponent.get(EarthProperty.OPEN_PLANET_MAPS)[0], constraints);
                
        // Planet Maps API Key
        constraints.gridy++;
        constraints.gridx = 0;
        constraints.gridwidth = 1;
        final JLabel labelPlanet = new JLabel(Messages.getString("OptionWizard.101"));
        panel.add(labelPlanet, constraints);
        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.PLANET_MAPS_KEY)[0], constraints);

        // Maxar SecureWatch
        constraints.gridx = 0;
        constraints.gridy++;
        constraints.gridwidth = 2;
        panel.add(propertyToComponent.get(EarthProperty.OPEN_MAXAR_SECUREWATCH)[0], constraints);

        // Maxar URL
        constraints.gridy++;
        constraints.gridwidth = 1;
        final JLabel labelMaxar = new JLabel(Messages.getString("OptionWizard.1021"));
        panel.add(labelMaxar, constraints);
        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.MAXAR_SECUREWATCH_URL)[0], constraints);

        // Extra Map URL
        constraints.gridy++;
        constraints.gridwidth = 2;
        constraints.gridx = 0;
        final JLabel labelExtra = new JLabel(Messages.getString("OptionWizard.103"));
        panel.add(labelExtra, constraints);
        constraints.gridy++;
        panel.add(propertyToComponent.get(EarthProperty.EXTRA_MAP_URL)[0], constraints);

        return panel;
    }
    
    /**
     * Creates the external services panel (reorganized from integrations).
     */
    private JComponent getExternalServicesPanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();

        // Google Earth Engine App
        panel.add(propertyToComponent.get(EarthProperty.OPEN_GEE_APP)[0], constraints);
        constraints.gridx = 1;
        JPanel panelGeeApp = getGeeAppOptionsPanel(panel, constraints);

        // Add GEE App options panel
        constraints.gridx = 0;
        constraints.gridy++;
        constraints.gridwidth = 4;
        panel.add(panelGeeApp, constraints);
        
        // Earth Map
        constraints.gridy++;
        constraints.gridwidth = 1;
        panel.add(propertyToComponent.get(EarthProperty.OPEN_EARTH_MAP)[0], constraints);

        // Planet Maps
        constraints.gridy++;
        constraints.gridwidth = 1;
        panel.add(propertyToComponent.get(EarthProperty.OPEN_PLANET_MAPS)[0], constraints);
                
        // Planet Maps API Key
        constraints.gridy++;
        constraints.gridx = 0;
        constraints.gridwidth = 1;
        final JLabel labelPlanet = new JLabel(Messages.getString("OptionWizard.101"));
        panel.add(labelPlanet, constraints);
        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.PLANET_MAPS_KEY)[0], constraints);

        // Maxar SecureWatch
        constraints.gridx = 0;
        constraints.gridy++;
        constraints.gridwidth = 2;
        panel.add(propertyToComponent.get(EarthProperty.OPEN_MAXAR_SECUREWATCH)[0], constraints);

        // Maxar URL
        constraints.gridy++;
        constraints.gridwidth = 1;
        final JLabel labelMaxar = new JLabel(Messages.getString("OptionWizard.1021"));
        panel.add(labelMaxar, constraints);
        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.MAXAR_SECUREWATCH_URL)[0], constraints);

        // Extra Map URL with improved layout
        constraints.gridy++;
        constraints.gridwidth = 2;
        constraints.gridx = 0;
        final JLabel labelExtra = new JLabel(Messages.getString("OptionWizard.103"));
        labelExtra.setToolTipText("Custom map service URL with placeholders for LATITUDE, LONGITUDE, PLOT_ID, or GEOJSON");
        panel.add(labelExtra, constraints);
        constraints.gridy++;
        panel.add(propertyToComponent.get(EarthProperty.EXTRA_MAP_URL)[0], constraints);

        return panel;
    }

    /**
     * Creates the Google Earth Engine App options panel.
     */
    private JPanel getGeeAppOptionsPanel(JPanel mainPanel, GridBagConstraints constraints) {
        JPanel panelGeeApp = new JPanel();
        
        // Create and configure the panel with date pickers
        JCheckBox specifyStartAndEndGeeApp = new JCheckBox(Messages.getString("OptionWizard.120"));
        mainPanel.add(specifyStartAndEndGeeApp, constraints);

        // Set up visibility based on GEE App checkbox state
        JCheckBox geeAppCheckbox = (JCheckBox) propertyToComponent.get(EarthProperty.OPEN_GEE_APP)[0];
        geeAppCheckbox.addActionListener(e -> { 
            boolean geeAppSelected = geeAppCheckbox.isSelected();
            boolean dateRangeSelected = specifyStartAndEndGeeApp.isSelected();
            
            panelGeeApp.setVisible(geeAppSelected && dateRangeSelected);
            specifyStartAndEndGeeApp.setVisible(geeAppSelected);
            
            if (!geeAppSelected) {
                specifyStartAndEndGeeApp.setSelected(false);
            }
        });
        
        // Add date picker components
        final JLabel labelGeeFromDate = new JLabel(Messages.getString("OptionWizard.121"));
        panelGeeApp.add(labelGeeFromDate);
        panelGeeApp.add(propertyToComponent.get(EarthProperty.GEEAPP_FROM_DATE)[0]);
        
        final JLabel labelGeeToDate = new JLabel(Messages.getString("OptionWizard.122"));
        panelGeeApp.add(labelGeeToDate);
        panelGeeApp.add(propertyToComponent.get(EarthProperty.GEEAPP_TO_DATE)[0]);

        // Initialize visibility based on saved properties
        boolean hasFromDate = StringUtils.isNotBlank(localPropertiesService.getValue(EarthProperty.GEEAPP_FROM_DATE));
        specifyStartAndEndGeeApp.setSelected(hasFromDate);
        panelGeeApp.setVisible(hasFromDate && geeAppCheckbox.isSelected());
        specifyStartAndEndGeeApp.setVisible(geeAppCheckbox.isSelected());
        
        // Set up date pickers when checkbox is selected/deselected
        specifyStartAndEndGeeApp.addActionListener(e -> {
            if (specifyStartAndEndGeeApp.isSelected()) {
                initializeDatePickers();
                panelGeeApp.setVisible(true);
            } else {
                clearDatePickers();
                panelGeeApp.setVisible(false);
            }
        });
        
        return panelGeeApp;
    }
    
    /**
     * Initialize date pickers with default values.
    private void initializeDatePickers() {
        SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd");
        try {
            JXDatePicker fromDatePicker = (JXDatePicker) propertyToComponent.get(EarthProperty.GEEAPP_FROM_DATE)[0];
            fromDatePicker.setDate(dateFormat.parse(START_OF_LANDSAT_AND_MODIS));
            
            JXDatePicker toDatePicker = (JXDatePicker) propertyToComponent.get(EarthProperty.GEEAPP_TO_DATE)[0];
            toDatePicker.setDate(Calendar.getInstance().getTime());
        } catch (ParseException e) {
            logger.error("Error parsing date", e);
        }
    }
     */
    
    /**
     * Clear date pickers.
     */
    private void clearDatePickers() {
        JXDatePicker fromDatePicker = (JXDatePicker) propertyToComponent.get(EarthProperty.GEEAPP_FROM_DATE)[0];
        fromDatePicker.setDate(null);
        
        JXDatePicker toDatePicker = (JXDatePicker) propertyToComponent.get(EarthProperty.GEEAPP_TO_DATE)[0];
        toDatePicker.setDate(null);
    }

    /**
     * Creates the Apply Changes button.
     */
    private Component getApplyChangesButton() {
        if (applyChanges == null) {
            applyChanges = new JButton(Messages.getString("OptionWizard.15"));
            applyChanges.addActionListener(
                    new ApplyOptionChangesListener(this, localPropertiesService, propertyToComponent) {
                        @Override
                        protected void applyProperties() {
                            // Show progress and disable button
                            applyChanges.setText("Applying Changes...");
                            applyChanges.setEnabled(false);
                            setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.WAIT_CURSOR));
                            
                            new Thread("Applying properties dialog") {
                                @Override
                                public void run() {
                                    try {
                                        // Validate before saving
                                        if (validateFields()) {
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
                                            javax.swing.SwingUtilities.invokeLater(() -> {
                                                showValidationErrorMessage();
                                            });
                                        }
                                    } catch (Exception e) {
                                        javax.swing.SwingUtilities.invokeLater(() -> {
                                            showErrorMessage(e);
                                        });
                                    } finally {
                                        // Reset button state
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
        this.dispose();
    }

    /**
     * Creates the Cancel button.
     */
    private Component getCancelButton() {
        final JButton cancelButton = new JButton(Messages.getString("OptionWizard.24"));
        cancelButton.addActionListener(e -> PropertiesDialog.this.dispose());
        return cancelButton;
    }
    
    /**
     * Creates the database and server configuration panel.
     */
    private JComponent getDatabaseServerPanel() {
        final JPanel mainPanel = new JPanel(new GridBagLayout());
        mainPanel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();
        constraints.fill = GridBagConstraints.BOTH;
        
        // Server configuration section
        JPanel serverPanel = getServerPanel();
        constraints.gridy = 0;
        constraints.weighty = 1.0;
        mainPanel.add(serverPanel, constraints);
        
        return new JScrollPane(mainPanel, ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, 
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
    }
    
    /**
     * Creates the browser and display options panel.
     */
    private JComponent getBrowserDisplayPanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();

        // Browser chooser panel
        final JPanel browserChooserPanel = createBrowserChooserPanel();
        constraints.gridy++;
        panel.add(browserChooserPanel, constraints);

        // Saiku server folder
        constraints.gridy++;
        panel.add(propertyToComponent.get(EarthProperty.SAIKU_SERVER_FOLDER)[0], constraints);
        
        // Open in separate window checkbox
        constraints.gridy++;
        panel.add(propertyToComponent.get(EarthProperty.OPEN_BALLOON_IN_BROWSER)[0], constraints);

        return panel;
    }

    /**
     * Creates the operation mode panel.
     */
    private JComponent getOperationModePanel() {
        final JPanel typeOfUsePanel = new JPanel(new GridBagLayout());
        final Border border = new TitledBorder(new BevelBorder(BevelBorder.LOWERED),
                Messages.getString("OptionWizard.2"));
        typeOfUsePanel.setBorder(border);

        final GridBagConstraints constraints = createDefaultConstraints();
        JPanel serverPanel = getServerPanel();
        typeOfUsePanel.add(serverPanel, constraints);

        return typeOfUsePanel;
    }

    /**
     * Enable or disable database options based on database type.
     */
    private void enableDBOptions(boolean isPostgreDb) {
        enableContainer(postgresPanel, isPostgreDb);
        enableContainer(sqlitePanel, !isPostgreDb);
    }

    /**
     * Get listener for database type selection.
     */
    private ActionListener getDbTypeListener() {
        return e -> {
            final JRadioButton theJRB = (JRadioButton) e.getSource();
            boolean isPostgreDb = theJRB.getName().equals(CollectDBDriver.POSTGRESQL.name());
            enableDBOptions(isPostgreDb);
        };
    }

    /**
     * Create scroll pane for projects panel.
     */
    private JComponent getProjectsPanelScroll() {
        final JComponent projectsPanel = getProjectsPanel();
        return new JScrollPane(projectsPanel, ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, 
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
    }

    /**
     * Create the projects panel.
     */
    private JComponent getProjectsPanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();
        constraints.fill = GridBagConstraints.BOTH;

        // Import new project button
        JButton importNewButton = createImportProjectButton();
        panel.add(importNewButton, constraints);

        // Projects list panel
        final JPanel projectsListPanel = createProjectsListPanel();
        constraints.gridx = 0;
        constraints.gridy = 1;
        panel.add(projectsListPanel, constraints);

        return panel;
    }
    
    /**
     * Create button for importing projects.
     */
    private JButton createImportProjectButton() {
        JButton importNewButton = new JButton(Messages.getString("OptionWizard.41"));
        importNewButton.addActionListener(new ApplyOptionChangesListener(this, localPropertiesService) {
            @Override
            protected void applyProperties() {
                if( importProject() ) restartEarth();
            }
        });
        return importNewButton;
    }
    
    /**
     * Import a project file.
     */
    private boolean importProject() {
        final File[] selectedProjectFile = JFileChooserExistsAware.getFileChooserResults(
                DataFormat.PROJECT_DEFINITION_FILE, false, false, null, localPropertiesService,
                (JFrame) PropertiesDialog.this.getParent());
        boolean success = false;
        if (selectedProjectFile != null && selectedProjectFile.length == 1) {
            try {
                projectsService.loadCompressedProjectFile(selectedProjectFile[0]);
                success = true;
            } catch (Exception e1) {
                JOptionPane.showMessageDialog(PropertiesDialog.this, e1.getMessage(),
                        Messages.getString("OptionWizard.51"), JOptionPane.ERROR_MESSAGE);
                logger.error("Error importing project file " + selectedProjectFile[0].getAbsolutePath(), e1);
            }
        }
        return success;
    }
    
    /**
     * Create panel with list of projects.
     */
    private JPanel createProjectsListPanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
                Messages.getString("OptionWizard.57"));
        panel.setBorder(border);

        final GridBagConstraints constraints = createDefaultConstraints();
        
        // Create and add projects list
        JList<String> projectsList = createProjectsList();
        JScrollPane listScroller = new JScrollPane(projectsList);
        listScroller.setPreferredSize(new Dimension(250, 300));
        
        
        constraints.gridy = 0;
        constraints.gridx = GridBagConstraints.RELATIVE;
        panel.add(listScroller, constraints);

        // Open project button
        JButton openProjectButton = createOpenProjectButton(projectsList);
        openProjectButton.setEnabled(false);
        panel.add(openProjectButton);

        // Update button state when selection changes
        projectsList.addListSelectionListener(e -> 
            openProjectButton.setEnabled(projectsList.getSelectedValue() != null));

        return panel;
    }
    
    /**
     * Create list of projects with double-click support.
     */
    private JList<String> createProjectsList() {
        List<String> projectNames = new ArrayList<>(projectsService.getProjectList().keySet());
        Collections.sort(projectNames);
        
        final JList<String> projectsList = new JList<>(projectNames.toArray(new String[0]));
        projectsList.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        projectsList.setLayoutOrientation(JList.VERTICAL);
        projectsList.setVisibleRowCount(-1);
        projectsList.setToolTipText("Double-click a project to load it, or select and use the button below");
        
        // Add double-click listener to load project
        projectsList.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2 && !e.isConsumed()) {
                    e.consume();
                    int index = projectsList.locationToIndex(e.getPoint());
                    if (index >= 0) {
                        projectsList.setSelectedIndex(index);
                        loadSelectedProject(projectsList);
                    }
                }
            }
        });
        
        return projectsList;
    }
    
    /**
     * Load the selected project with progress feedback (used by both button and double-click).
     */
    private void loadSelectedProject(JList<String> projectsList) {
        new ApplyOptionChangesListener(this, localPropertiesService) {
            @Override
            protected void applyProperties() {
                if (openSelectedProject(projectsList)) {
                    restartEarth();
                }
            }
        }.actionPerformed(null);
    }
    
    /**
     * Create button for opening selected project.
     */
    private JButton createOpenProjectButton(JList<String> projectsList) {
        final JButton openProject = new JButton(Messages.getString("OptionWizard.56"));
        openProject.addActionListener(e -> loadSelectedProject(projectsList));
        return openProject;
    }
    
    /**
     * Open the selected project.
     */
    private boolean openSelectedProject(JList<String> projectsList) {
        String selectedProject = projectsList.getSelectedValue();
        boolean success = false;
        if (selectedProject != null) {
            File projectFolder = projectsService.getProjectList().get(selectedProject);
            try {
                projectsService.loadProjectInFolder(projectFolder);
                success = true;
            } catch (Exception e) {
                JOptionPane.showMessageDialog(PropertiesDialog.this, e.getMessage(),
                        Messages.getString("OptionWizard.55"), JOptionPane.ERROR_MESSAGE);
                logger.error("Error importing project folder " + projectFolder.getAbsolutePath(), e);
            }
        }
        return success;
    }

    /**
     * Create scrollable operation mode panel.
     */
    private JScrollPane getOperationModePanelScroll() {
        final JComponent operationModePanel = getOperationModePanel();
        return new JScrollPane(operationModePanel, ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, 
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
    }

    /**
     * Create the plot options panel.
     */
    @SuppressWarnings("unchecked")
    private JComponent getPlotOptionsPanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridx = 0;
        constraints.gridy = 0;
        constraints.ipady = 5; // Reduced from 15 to 5
        constraints.ipadx = 5;
        constraints.anchor = GridBagConstraints.LINE_START;
        constraints.insets = new Insets(5, 5, 5, 15); // More reasonable spacing
        constraints.fill = GridBagConstraints.HORIZONTAL;

		// Plot shape selector
		final JLabel plotShapeLabel = new JLabel(Messages.getString("OptionWizard.128"));
		panel.add(plotShapeLabel, constraints);

		constraints.gridx = 1;
		JComboBox<SAMPLE_SHAPE> plotShape = (JComboBox<SAMPLE_SHAPE>) propertyToComponent.get(EarthProperty.SAMPLE_SHAPE)[0];
		panel.add(plotShape, constraints);

		// Number of points
		constraints.gridx = 0;
		constraints.gridy++;
		final JLabel numberPointsLabel = new JLabel(Messages.getString("OptionWizard.35"));
		panel.add(numberPointsLabel, constraints);

		constraints.gridx = 1;
		JComboBox<ComboBoxItem> numberPoints = (JComboBox<ComboBoxItem>) propertyToComponent
				.get(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)[0];
		panel.add(numberPoints, constraints);
		componentToRowLabel.put(numberPoints, numberPointsLabel);

		// Distance between points
		constraints.gridx = 0;
		constraints.gridy++;
		JLabel distanceOrRadiusLabel = new JLabel(Messages.getString("OptionWizard.36"));
		panel.add(distanceOrRadiusLabel, constraints);

		constraints.gridx = 1;
		JSpinner distanceBetweenPoints = (JSpinner) propertyToComponent
				.get(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)[0];
		panel.add(distanceBetweenPoints, constraints);
		componentToRowLabel.put(distanceBetweenPoints, distanceOrRadiusLabel);

		// Distance to frame
		constraints.gridx = 0;
		constraints.gridy++;
		final JLabel distanceToFrameLabel = new JLabel(Messages.getString("OptionWizard.37"));
		panel.add(distanceToFrameLabel, constraints);
		
		constraints.gridx = 1;
		JSpinner distanceToFrame = (JSpinner) propertyToComponent
				.get(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES)[0];
		panel.add(distanceToFrame, constraints);
		componentToRowLabel.put(distanceToFrame, distanceToFrameLabel);

		// Dots side
		constraints.gridx = 0;
		constraints.gridy++;
		final JLabel dotsSideLabel = new JLabel(Messages.getString("OptionWizard.95"));
		panel.add(dotsSideLabel, constraints);
		
		constraints.gridx = 1;
		JSpinner dotsSide = (JSpinner) propertyToComponent.get(EarthProperty.INNER_SUBPLOT_SIDE)[0];
		panel.add(dotsSide, constraints);
		componentToRowLabel.put(dotsSide, dotsSideLabel);

		// Central plot side
		constraints.gridx = 0;
		constraints.gridy++;
		final JLabel largeCentralPlotSideLabel = new JLabel(Messages.getString("OptionWizard.129"));
		panel.add(largeCentralPlotSideLabel, constraints);
		
		constraints.gridx = 1;
		JSpinner largeCentralPlotSide = (JSpinner) propertyToComponent.get(EarthProperty.LARGE_CENTRAL_PLOT_SIDE)[0];
		panel.add(largeCentralPlotSide, constraints);
		componentToRowLabel.put(largeCentralPlotSide, largeCentralPlotSideLabel);

		// Distance between plots in cluster
		constraints.gridx = 0;
		constraints.gridy++;
		final JLabel plotDistanceInClusterLabel = new JLabel(Messages.getString("OptionWizard.130"));
		panel.add(plotDistanceInClusterLabel, constraints);
		
		constraints.gridx = 1;
		JSpinner plotDistanceInCluster = (JSpinner) propertyToComponent
				.get(EarthProperty.DISTANCE_BETWEEN_PLOTS)[0];
		panel.add(plotDistanceInCluster, constraints);
		componentToRowLabel.put(plotDistanceInCluster, plotDistanceInClusterLabel);

        // Area display
        constraints.gridx = 0;
        constraints.gridy++;
        JLabel area = new JLabel(
                Messages.getString("OptionWizard.131") + calculateArea(numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide));
        panel.add(area, constraints);

        // Set up change listeners for spinners
        javax.swing.event.ChangeListener calculateAreasListener = e ->
            area.setText(Messages.getString("OptionWizard.131") + calculateArea(numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide));

        // Action listener for combo box (converts ActionEvent to area calculation)
        ActionListener calculateAreasActionListener = e ->
            area.setText(Messages.getString("OptionWizard.131") + calculateArea(numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide));

		plotShape.addActionListener(e ->
				handleVisibilityPlotLayout(plotShape, numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide,
						plotDistanceInCluster, area, largeCentralPlotSide)
		);

        numberPoints.addActionListener(calculateAreasActionListener);
        distanceBetweenPoints.addChangeListener(calculateAreasListener);
        distanceToFrame.addChangeListener(calculateAreasListener);

        // Initialize visibility
		handleVisibilityPlotLayout(plotShape, numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide,
				plotDistanceInCluster, area, largeCentralPlotSide);

		return panel;
	}

    /**
     * Handle visibility of plot layout components based on selected shape.
     */
	public void handleVisibilityPlotLayout(JComboBox<SAMPLE_SHAPE> plotShape, JComboBox<ComboBoxItem> numberPoints, 
			JSpinner distanceBetweenPoints, JSpinner distanceToFrame, JSpinner dotsSide, 
			JSpinner distanceBetweenPlots, JLabel area, JSpinner largeCentralPlotSide) {
		
		// First, disable all components
		setRowState(numberPoints, false);
		setRowState(distanceBetweenPoints, false);
		setRowState(distanceToFrame, false);
		setRowState(dotsSide, false);
		setRowState(distanceBetweenPlots, false);
		setRowState(largeCentralPlotSide, false);
		area.setVisible(false);

		// Then enable specific components based on the selected shape
		SAMPLE_SHAPE selectedShape = (SAMPLE_SHAPE) plotShape.getSelectedItem();
		JLabel distanceOrRadiusLabel = componentToRowLabel.get(distanceBetweenPoints);
		
		if (selectedShape == SAMPLE_SHAPE.SQUARE || selectedShape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT) {
			setRowState(numberPoints, true);
			setRowState(distanceBetweenPoints, true);
			setRowState(distanceToFrame, true);
			setRowState(dotsSide, true);
			area.setVisible(true);
			if (distanceOrRadiusLabel != null) {
				distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.36"));
			}

			if (selectedShape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT) {
				setRowState(largeCentralPlotSide, true);
			}
		} else if (selectedShape == SAMPLE_SHAPE.CIRCLE || selectedShape == SAMPLE_SHAPE.HEXAGON) {
			setRowState(distanceBetweenPoints, true);
			setRowState(dotsSide, true);
			setRowState(numberPoints, true);
			if (distanceOrRadiusLabel != null) {
				distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.132"));
			}
		} else if (selectedShape == SAMPLE_SHAPE.NFI_THREE_CIRCLES || selectedShape == SAMPLE_SHAPE.NFI_FOUR_CIRCLES) {
			setRowState(dotsSide, true);
			setRowState(distanceBetweenPoints, true);
			setRowState(distanceBetweenPlots, true);
			if (distanceOrRadiusLabel != null) {
				distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.133"));
			}
		}

		Component parent = plotShape.getParent();
		if (parent != null) {
			parent.revalidate();
			parent.repaint();
		}
	}

	private void setRowState(JComponent component, boolean enabledAndVisible) {
		component.setEnabled(enabledAndVisible);
		component.setVisible(enabledAndVisible);
		JLabel label = componentToRowLabel.get(component);
		if (label != null) {
			label.setVisible(enabledAndVisible);
		}
		Component parent = component.getParent();
		if (parent != null) {
			parent.revalidate();
			parent.repaint();
		}
	}

    /**
     * Calculate the area based on plot parameters.
     */
    private String calculateArea(JComboBox<ComboBoxItem> numberOfPoints, JSpinner distanceBetweenPoints, 
            JSpinner distanceToFrame, JSpinner dotsSide) {
        
        double side = 0;
        try {
            int numberOfPointsI = ((ComboBoxItem) numberOfPoints.getSelectedItem()).getNumberOfPoints();
            int distanceBetweenPointsI = (Integer) distanceBetweenPoints.getValue();
            int distanceToFrameI = (Integer) distanceToFrame.getValue();
			@SuppressWarnings("unchecked")
			JComboBox<SAMPLE_SHAPE> plotShapeCombo = (JComboBox<SAMPLE_SHAPE>) propertyToComponent
					.get(EarthProperty.SAMPLE_SHAPE)[0];
			SAMPLE_SHAPE selectedShape = (SAMPLE_SHAPE) plotShapeCombo.getSelectedItem();
			boolean squareVariant = selectedShape == SAMPLE_SHAPE.SQUARE
					|| selectedShape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT;
			boolean circleVariant = selectedShape == SAMPLE_SHAPE.CIRCLE || selectedShape == SAMPLE_SHAPE.HEXAGON;
			boolean nfiVariant = selectedShape == SAMPLE_SHAPE.NFI_THREE_CIRCLES
					|| selectedShape == SAMPLE_SHAPE.NFI_FOUR_CIRCLES;
			boolean manageLayoutControls = squareVariant || circleVariant || nfiVariant;

            if (numberOfPointsI == 0 || numberOfPointsI == 1) {
                // Single point or no points
                side = 2d * distanceToFrameI;
                if (oldSelectedDistance == null) {
                    oldSelectedDistance = distanceBetweenPointsI + "";
                }
				distanceBetweenPoints.setValue(0);

				if (manageLayoutControls) {
					setRowState(distanceBetweenPoints, false);
					setRowState(dotsSide, numberOfPointsI == 1);
				} else {
					distanceBetweenPoints.setEnabled(false);
					dotsSide.setEnabled(numberOfPointsI == 1);
				}
            } else {
                // Multiple points
                if (oldSelectedDistance != null) {
                    try {
                        distanceBetweenPoints.setValue(Integer.parseInt(oldSelectedDistance));
                    } catch (NumberFormatException e) {
                        // Use default if parsing fails
                        distanceBetweenPoints.setValue(10);
                    }
                    oldSelectedDistance = null;
                }

				if (manageLayoutControls) {
					setRowState(distanceBetweenPoints, true);
					setRowState(dotsSide, true);
					if (squareVariant) {
						setRowState(distanceToFrame, true);
					}
				} else {
					distanceBetweenPoints.setEnabled(true);
					distanceToFrame.setEnabled(true);
					dotsSide.setEnabled(true);
				}

                double pointsByLines = Math.sqrt(numberOfPointsI);
                side = 2d * distanceToFrameI + (pointsByLines - 1) * distanceBetweenPointsI;
            }
        } catch (RuntimeException e) {
            logger.error("Error calculating area of the plot", e);
        }

        DecimalFormat df = new DecimalFormat("###.##");
        return df.format(side * side / 10000d); // Convert to hectares
    }

    /**
     * Create the PostgreSQL configuration panel.
     */
    private JPanel getPostgreSqlPanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();

        final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
                Messages.getString("OptionWizard.6"));
        panel.setBorder(border);

        // Username
        JLabel label = new JLabel(Messages.getString("OptionWizard.7"));
        constraints.gridx = 0;
        panel.add(label, constraints);

        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.DB_USERNAME)[0], constraints);

        // Password
        constraints.gridy++;
        label = new JLabel(Messages.getString("OptionWizard.8"));
        constraints.gridx = 0;
        panel.add(label, constraints);

        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.DB_PASSWORD)[0], constraints);

        // Database name
        constraints.gridy++;
        label = new JLabel(Messages.getString("OptionWizard.9"));
        constraints.gridx = 0;
        panel.add(label, constraints);

        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.DB_NAME)[0], constraints);

        // Host
        constraints.gridy++;
        label = new JLabel(Messages.getString("OptionWizard.26"));
        constraints.gridx = 0;
        panel.add(label, constraints);

        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.DB_HOST)[0], constraints);

        // Port
        constraints.gridy++;
        label = new JLabel(Messages.getString("OptionWizard.29"));
        constraints.gridx = 0;
        panel.add(label, constraints);

        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.DB_PORT)[0], constraints);

        constraints.gridx = 2;
        panel.add(new JLabel(Messages.getString("OptionWizard.134")), constraints);

        // Test connection button
        constraints.gridy++;
        constraints.gridx = 1;
        JButton testButton = createTestConnectionButton();
        panel.add(testButton, constraints);

        return panel;
    }
    
    /**
     * Create button for testing PostgreSQL connection.
     */
    private JButton createTestConnectionButton() {
        JButton button = new JButton(Messages.getString("OptionWizard.135"));
        button.addActionListener(e -> {
            String host = ((JTextField) (propertyToComponent.get(EarthProperty.DB_HOST)[0])).getText();
            String port = ((JTextField) (propertyToComponent.get(EarthProperty.DB_PORT)[0])).getText();
            String dbName = ((JTextField) (propertyToComponent.get(EarthProperty.DB_NAME)[0])).getText();
            String username = ((JTextField) (propertyToComponent.get(EarthProperty.DB_USERNAME)[0])).getText();
            String password = ((JTextField) (propertyToComponent.get(EarthProperty.DB_PASSWORD)[0])).getText();

            String message = CollectEarthUtils.testPostgreSQLConnection(host, port, dbName, username, password);
            JOptionPane.showMessageDialog(PropertiesDialog.this.getOwner(), message, 
                    "PostgreSQL Connection test", JOptionPane.INFORMATION_MESSAGE);
        });
        return button;
    }

    /**
     * Create the SQLite configuration panel.
     */
    private JPanel getSqlLitePanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();

        final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
                Messages.getString("OptionWizard.30"));
        panel.setBorder(border);

        panel.add(propertyToComponent.get(EarthProperty.AUTOMATIC_BACKUP)[0], constraints);
        constraints.gridx++;
        panel.add(getOpenBackupFolderButton());
        return panel;
    }

    /**
     * Create the sample data panel.
     */
    private JComponent getSampleDataPanel() {
        final JPlotCsvTable samplePlots = new JPlotCsvTable(
                localPropertiesService.getValue(EarthProperty.SAMPLE_FILE), surveyLoaded);

        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();
        constraints.fill = GridBagConstraints.HORIZONTAL;

        // File picker for sample plots CSV
        final JFilePicker refreshTableOnFileChange = getFilePickerSamplePlots(samplePlots);
        panel.add(refreshTableOnFileChange, constraints);

        // Table of sample plots with better sizing
        samplePlots.setFillsViewportHeight(true);
        constraints.gridy = 1;
        constraints.weightx = 1.0;
        constraints.weighty = 1.0; // Allow vertical expansion
        constraints.gridwidth = GridBagConstraints.REMAINDER;
        constraints.gridheight = GridBagConstraints.REMAINDER;
        constraints.fill = GridBagConstraints.BOTH;

        // Create scroll pane with reasonable minimum size
        JScrollPane scrollPane = new JScrollPane(samplePlots, 
                ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED);
        scrollPane.setPreferredSize(new Dimension(600, 400));
        scrollPane.setMinimumSize(new Dimension(500, 300));
        
        panel.add(scrollPane, constraints);

        return panel;
    }

    /**
     * Set up file picker for sample plots.
     */
    private JFilePicker getFilePickerSamplePlots(final JPlotCsvTable samplePlots) {
        final JFilePicker refreshTableOnFileChange = (JFilePicker) (propertyToComponent
                .get(EarthProperty.SAMPLE_FILE)[0]);
        
        refreshTableOnFileChange.addChangeListener(new DocumentListener() {
            @Override
            public void changedUpdate(DocumentEvent e) {
                // Not used
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
                samplePlots.refreshTable(refreshTableOnFileChange.getSelectedFilePath());
                // Disable the apply button if sample data is invalid
                getApplyChangesButton().setEnabled(samplePlots.isDataValid());
            }
        });
        
        return refreshTableOnFileChange;
    }

    /**
     * Create the server panel.
     */
    private JPanel getServerPanel() {
        final JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        final GridBagConstraints constraints = createDefaultConstraints();

        final Border border = new TitledBorder(new BevelBorder(BevelBorder.RAISED),
                Messages.getString("OptionWizard.3"));
        panel.setBorder(border);

        // Server information
        JLabel label = new JLabel(Messages.getString("OptionWizard.4") + CollectEarthUtils.getComputerIp());
        panel.add(label, constraints);
        constraints.gridy++;

        // Port
        label = new JLabel(Messages.getString("OptionWizard.5"));
        constraints.gridx = 0;
        panel.add(label, constraints);

        constraints.gridx = 1;
        panel.add(propertyToComponent.get(EarthProperty.HOST_PORT_KEY)[0], constraints);

        // Database options
        constraints.gridwidth = GridBagConstraints.REMAINDER;
        constraints.gridy++;
        constraints.gridx = 0;

        // Create database panels
        final ButtonGroup buttonGroup = new ButtonGroup();
        final JComponent[] dbTypes = propertyToComponent.get(EarthProperty.DB_DRIVER);

        postgresPanel = getPostgreSqlPanel();
        sqlitePanel = getSqlLitePanel();

        boolean usingPostgreSQL = localPropertiesService.getCollectDBDriver().equals(CollectDBDriver.POSTGRESQL);
        enableDBOptions(usingPostgreSQL);

        // Add database type radio buttons
        for (final JComponent typeRadioButton : dbTypes) {
            final JRadioButton dbTypeButton = (JRadioButton) typeRadioButton;
            buttonGroup.add(dbTypeButton);
            panel.add(dbTypeButton, constraints);
            constraints.gridy++;

            dbTypeButton.addActionListener(getDbTypeListener());
            dbTypeButton.addActionListener(e -> setRestartRequired(true));

            // Add corresponding panel
            if (dbTypeButton.getName().equals(EarthConstants.CollectDBDriver.POSTGRESQL.name())) {
                panel.add(postgresPanel, constraints);
            } else {
                panel.add(sqlitePanel, constraints);
            }
            constraints.gridy++;
        }
        
        return panel;
    }

    /**
     * Create button to open backup folder.
     */
    private Component getOpenBackupFolderButton() {
        AbstractAction backupAction = new AbstractAction(Messages.getString("OptionWizard.10")) {
            private static final long serialVersionUID = 1L;

            @Override
            public void actionPerformed(ActionEvent e) {
                try {
                    CollectEarthUtils.openFolderInExplorer(backupFolder);
                } catch (final IOException e1) {
                    logger.error("Error when opening the explorer window to visualize backups", e1);
                }
            }
        };

        return new JButton(backupAction);
    }

    /**
     * Initialize all input components with values from properties.
     */
    private void initializeInputs() throws Exception {
        // Automatic backup checkbox
        final JCheckBox backupCheckbox = new JCheckBox(Messages.getString("OptionWizard.44"));
        backupCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.AUTOMATIC_BACKUP)));
        propertyToComponent.put(EarthProperty.AUTOMATIC_BACKUP, new JComponent[] { backupCheckbox });

        // Google Earth Engine Explorer checkbox
        final JCheckBox openEarthEngineCheckbox = new JCheckBox(Messages.getString("OptionWizard.45"));
        openEarthEngineCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_GEE_EXPLORER)));
        propertyToComponent.put(EarthProperty.OPEN_GEE_EXPLORER, new JComponent[] { openEarthEngineCheckbox });

        // Google Earth Engine App checkbox
        final JCheckBox openGEEAppCheckbox = new JCheckBox(Messages.getString("OptionWizard.136"));
        openGEEAppCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_GEE_APP)));
        propertyToComponent.put(EarthProperty.OPEN_GEE_APP, new JComponent[] { openGEEAppCheckbox });

        // Timelapse checkbox
        final JCheckBox openTimelapseCheckbox = new JCheckBox(Messages.getString("OptionWizard.46"));
        openTimelapseCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_TIMELAPSE)));
        propertyToComponent.put(EarthProperty.OPEN_TIMELAPSE, new JComponent[] { openTimelapseCheckbox });

        // Earth Map checkbox
        final JCheckBox openEarthMapCheckbox = new JCheckBox(Messages.getString("OptionWizard.105"));
        openEarthMapCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_EARTH_MAP)));
        propertyToComponent.put(EarthProperty.OPEN_EARTH_MAP, new JComponent[] { openEarthMapCheckbox });

        // Planet Maps checkbox
        final JCheckBox openPlanetCheckbox = new JCheckBox(Messages.getString("OptionWizard.100"));
        openPlanetCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_PLANET_MAPS)));
        propertyToComponent.put(EarthProperty.OPEN_PLANET_MAPS, new JComponent[] { openPlanetCheckbox });

        // Planet Maps API Key field
        final JPasswordField planetAPIKeyTextField = new JPasswordField(
                localPropertiesService.getValue(EarthProperty.PLANET_MAPS_KEY));
        planetAPIKeyTextField.setMinimumSize(new Dimension(250, 20));
        planetAPIKeyTextField.setEnabled(openPlanetCheckbox.isSelected());
        propertyToComponent.put(EarthProperty.PLANET_MAPS_KEY, new JComponent[] { planetAPIKeyTextField });

        // Enable API key text field when Planet is activated
        openPlanetCheckbox.addActionListener( e-> planetAPIKeyTextField.setEnabled(	openPlanetCheckbox.isSelected()	) );

        // Initialize date pickers for GEE App
        initializeDatePickers();
        
        // Maxar SecureWatch checkbox
        final JCheckBox openSecureWatchCheckbox = new JCheckBox(Messages.getString("OptionWizard.102"));
        openSecureWatchCheckbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_MAXAR_SECUREWATCH)));
        propertyToComponent.put(EarthProperty.OPEN_MAXAR_SECUREWATCH, new JComponent[] { openSecureWatchCheckbox });

        // Maxar SecureWatch URL field
        final JTextField secureWatchUrlTextField = new JTextField(
                localPropertiesService.getValue(EarthProperty.MAXAR_SECUREWATCH_URL));
        secureWatchUrlTextField.setMinimumSize(new Dimension(250, 20));
        secureWatchUrlTextField.setEnabled(localPropertiesService.isSecureWatchSupported());
        propertyToComponent.put(EarthProperty.MAXAR_SECUREWATCH_URL, new JComponent[] { secureWatchUrlTextField });
        openSecureWatchCheckbox.addActionListener(e -> 
            secureWatchUrlTextField.setEnabled(openSecureWatchCheckbox.isSelected()));

        // Extra Map URL field with improved validation
        final JTextField extraUrlTextField = new JTextField(
                localPropertiesService.getValue(EarthProperty.EXTRA_MAP_URL));
        extraUrlTextField.setMinimumSize(new Dimension(250, 20));
        extraUrlTextField.setToolTipText("Custom map service URL. Use placeholders: LATITUDE, LONGITUDE, PLOT_ID, or GEOJSON");
        
        // Create improved URL validator
        UrlPlaceholderVerifier urlValidator = new UrlPlaceholderVerifier();
        extraUrlTextField.setInputVerifier(urlValidator);
        addRealTimeValidation(extraUrlTextField, urlValidator);
        
        // Register placeholder text
        PromptSupport.setPrompt(
            "https://www.extramap.org/lat=LATITUDE&long=LONGITUDE&id=PLOT_ID",
            extraUrlTextField);
        
        propertyToComponent.put(EarthProperty.EXTRA_MAP_URL, new JComponent[] { extraUrlTextField });

        // Open in separate window checkbox
        final JCheckBox openInSeparateWindowCheckbox = new JCheckBox(Messages.getString("OptionWizard.48"));
        openInSeparateWindowCheckbox.setSelected(
                Boolean.parseBoolean(localPropertiesService.getValue(EarthProperty.OPEN_BALLOON_IN_BROWSER)));
        propertyToComponent.put(EarthProperty.OPEN_BALLOON_IN_BROWSER,
                new JComponent[] { openInSeparateWindowCheckbox });

        // Sample file picker
        final JFilePicker csvWithPlotData = new JFilePicker(Messages.getString("OptionWizard.49"),
                localPropertiesService.getValue(EarthProperty.SAMPLE_FILE), 
                Messages.getString("OptionWizard.50"), DlgMode.MODE_OPEN);
        csvWithPlotData.addFileTypeFilter(".csv,.ced", Messages.getString("OptionWizard.52"), true);
        propertyToComponent.put(EarthProperty.SAMPLE_FILE, new JComponent[] { csvWithPlotData });

        // Plot shape dropdown
        final JComboBox<SAMPLE_SHAPE> plotShape = new JComboBox<>(SAMPLE_SHAPE.values());
        try {
            plotShape.setSelectedItem(SAMPLE_SHAPE.valueOf(localPropertiesService.getValue(EarthProperty.SAMPLE_SHAPE)));
        } catch (Exception e) {
            logger.error("The selected shape type is not supported " + 
                    localPropertiesService.getValue(EarthProperty.SAMPLE_SHAPE), e);
        }
        propertyToComponent.put(EarthProperty.SAMPLE_SHAPE, new JComponent[] { plotShape });

        // Sampling points dropdown
        initializeSamplingPointsDropdown();
        
        // Distance components
        initializeDistanceComponents();
        
        // Browser chooser radio buttons
        initializeBrowserOptions();
        
        // Saiku path picker
        initializeSaikuPath();
        
        // Template pickers
        initializeTemplatePickers();
        
        // Database options
        initializeDatabaseOptions();
    }
    
    /**
     * Initialize GEE App date pickers.
     */
    private void initializeDatePickers() {
        try {
            logger.info("Initializing date pickers (SwingX components)...");
            //Allows year selection in JXDatePicker
            UIManager.put(CalendarHeaderHandler.uiControllerID, SpinningCalendarHeaderHandler.class.getName());

            SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd");

            // From date picker
            JXDatePicker geeAppFromDate = new JXDatePicker();
            geeAppFromDate.getMonthView().setZoomable(true); // needed for custom header
            geeAppFromDate.setFormats(dateFormat);
            try {
                geeAppFromDate.getMonthView().setLowerBound(dateFormat.parse(START_OF_LANDSAT_AND_MODIS));
                geeAppFromDate.getMonthView().setUpperBound(new Date());

                if (StringUtils.isNotBlank(localPropertiesService.getValue(EarthProperty.GEEAPP_FROM_DATE))) {
                    geeAppFromDate.setDate(dateFormat.parse(localPropertiesService.getValue(EarthProperty.GEEAPP_FROM_DATE)));
                }
            } catch (ParseException e) {
                logger.error("Error parsing date", e);
            }
            geeAppFromDate.setToolTipText("Sets the starting date to analyze imagery in the GEE App");
            geeAppFromDate.setMinimumSize(new Dimension(250, 20));
            propertyToComponent.put(EarthProperty.GEEAPP_FROM_DATE, new JComponent[] { geeAppFromDate });

            // To date picker
            JXDatePicker geeAppToDate = new JXDatePicker();
            geeAppToDate.getMonthView().setZoomable(true); // needed for custom header
            geeAppToDate.setFormats(dateFormat);
            try {
                geeAppToDate.getMonthView().setLowerBound(dateFormat.parse(START_OF_LANDSAT_AND_MODIS));
                geeAppToDate.getMonthView().setUpperBound(new Date());

                if (StringUtils.isNotBlank(localPropertiesService.getValue(EarthProperty.GEEAPP_TO_DATE))) {
                    geeAppToDate.setDate(dateFormat.parse(localPropertiesService.getValue(EarthProperty.GEEAPP_TO_DATE)));
                }
            } catch (ParseException e) {
                logger.error("Error parsing date", e);
            }
            geeAppToDate.setToolTipText("Sets the end date to analyze imagery in the GEE App");
            geeAppToDate.setMinimumSize(new Dimension(250, 20));
            propertyToComponent.put(EarthProperty.GEEAPP_TO_DATE, new JComponent[] { geeAppToDate });

            logger.info("Date pickers initialized successfully");
        } catch (Exception e) {
            logger.error("Failed to initialize date pickers (SwingX). This may be due to missing SwingX library components.", e);
            throw new RuntimeException("Failed to initialize date picker components: " + e.getMessage(), e);
        } catch (Error e) {
            logger.error("Critical error initializing date pickers. Possible classloading issue with SwingX library.", e);
            throw e;
        }
    }
    
    /**
     * Initialize sampling points dropdown.
     */
    private void initializeSamplingPointsDropdown() {
        final JComboBox<ComboBoxItem> comboNumberOfPoints = new JComboBox<>(
                new ComboBoxItem[] { 
                    COMBO_BOX_ITEM_SQUARE, 
                    COMBO_BOX_ITEM_CENTRAL_POINT, 
                    new ComboBoxItem(4, "2x2"),
                    new ComboBoxItem(9, "3x3"), 
                    new ComboBoxItem(16, "4x4"), 
                    new ComboBoxItem(25, "5x5"),
                    new ComboBoxItem(36, "6x6"),
                    new ComboBoxItem(49, "7x7") 
                });
        
        if (StringUtils.isNotBlank(localPropertiesService.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT))) {
            try {
                comboNumberOfPoints.setSelectedItem(new ComboBoxItem(
                        Integer.parseInt(localPropertiesService.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)),
                        ""));
            } catch (NumberFormatException e) {
                logger.error("Invalid number of sampling points: {}", 
                        localPropertiesService.getValue(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT), e);
            }
        }
        
        propertyToComponent.put(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT,
                new JComponent[] { comboNumberOfPoints });
    }
    
    /**
     * Initialize distance-related components with user-friendly spinners.
     */
    private void initializeDistanceComponents() {
        // Distance between sampling points (min: 2, max: 1000, step: 1)
        int distanceBetweenPoints = parseIntWithinRange(
                localPropertiesService.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS), 10, 2, 1000);
        final JSpinner spinnerDistanceBetweenPoints = new JSpinner(
                new SpinnerNumberModel(distanceBetweenPoints, 2, 1000, 1));
        spinnerDistanceBetweenPoints.setToolTipText("Distance between sampling points in meters (2-1000)");
        propertyToComponent.put(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS,
                new JComponent[] { spinnerDistanceBetweenPoints });

        // Distance between plots (min: 2, max: 1000, step: 1)
        int distanceBetweenPlots = parseIntWithinRange(
                localPropertiesService.getValue(EarthProperty.DISTANCE_BETWEEN_PLOTS), 100, 2, 1000);
        final JSpinner spinnerDistanceBetweenPlots = new JSpinner(
                new SpinnerNumberModel(distanceBetweenPlots, 2, 1000, 1));
        spinnerDistanceBetweenPlots.setToolTipText("Distance between plots in cluster in meters (2-1000)");
        propertyToComponent.put(EarthProperty.DISTANCE_BETWEEN_PLOTS, 
                new JComponent[] { spinnerDistanceBetweenPlots });

        // Distance to plot boundaries (min: 0, max: 500, step: 1)
        int distanceToBorder = parseIntWithinRange(
                localPropertiesService.getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES), 0, 0, 500);
        final JSpinner spinnerDistanceToBorder = new JSpinner(
                new SpinnerNumberModel(distanceToBorder, 0, 500, 1));
        spinnerDistanceToBorder.setToolTipText("Distance to plot boundaries in meters (0-500)");
        propertyToComponent.put(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, 
                new JComponent[] { spinnerDistanceToBorder });

        // Inner subplot side (min: 2, max: 100, step: 1)
        int innerSubplotSide = parseIntWithinRange(
                localPropertiesService.getValue(EarthProperty.INNER_SUBPLOT_SIDE), 2, 2, 100);
        final JSpinner spinnerInnerSubplotSide = new JSpinner(
                new SpinnerNumberModel(innerSubplotSide, 2, 100, 1));
        spinnerInnerSubplotSide.setToolTipText("Size of inner subplot side in meters (2-100)");
        propertyToComponent.put(EarthProperty.INNER_SUBPLOT_SIDE, 
                new JComponent[] { spinnerInnerSubplotSide });

        // Large central plot side (min: 2, max: 200, step: 1)
        int largeCentralPlotSide = parseIntWithinRange(
                localPropertiesService.getValue(EarthProperty.LARGE_CENTRAL_PLOT_SIDE), 20, 2, 200);
        final JSpinner spinnerLargeCentralPlotSide = new JSpinner(
                new SpinnerNumberModel(largeCentralPlotSide, 2, 200, 1));
        spinnerLargeCentralPlotSide.setToolTipText("Size of large central plot side in meters (2-200)");
        propertyToComponent.put(EarthProperty.LARGE_CENTRAL_PLOT_SIDE, 
                new JComponent[] { spinnerLargeCentralPlotSide });
    }
    
    /**
     * Helper method to parse integer values with a default fallback clamped to a range.
     */
    private int parseIntWithinRange(String value, int defaultValue, int min, int max) {
        int parsedValue = defaultValue;
        try {
            if (StringUtils.isNotBlank(value)) {
                parsedValue = Integer.parseInt(value.trim());
            }
        } catch (NumberFormatException e) {
            logger.warn("Invalid integer value '{}', using default: {}", value, defaultValue);
            parsedValue = defaultValue;
        }
        if (parsedValue < min) {
            logger.warn("Value '{}' is below minimum {}. Clamping to {}", parsedValue, min, min);
            return min;
        }
        if (parsedValue > max) {
            logger.warn("Value '{}' is above maximum {}. Clamping to {}", parsedValue, max, max);
            return max;
        }
        return parsedValue;
    }
    
    /**
     * Initialize browser options.
     */
    private void initializeBrowserOptions() {
        final JRadioButton firefoxChooser = new JRadioButton("Firefox");
        firefoxChooser.setSelected(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim()
                .equals(EarthConstants.FIREFOX_BROWSER));
        firefoxChooser.setName(EarthConstants.FIREFOX_BROWSER);

        final JRadioButton chromeChooser = new JRadioButton("Chrome");
        chromeChooser.setSelected(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim()
                .equals(EarthConstants.CHROME_BROWSER));
        chromeChooser.setName(EarthConstants.CHROME_BROWSER);

        final JRadioButton edgeChooser = new JRadioButton("Edge");
        edgeChooser.setSelected(localPropertiesService.getValue(EarthProperty.BROWSER_TO_USE).trim()
                .equals(EarthConstants.EDGE_BROWSER));
        edgeChooser.setName(EarthConstants.EDGE_BROWSER);

        propertyToComponent.put(EarthProperty.BROWSER_TO_USE, 
                new JComponent[] { firefoxChooser, chromeChooser, edgeChooser });
    }
    
    /**
     * Initialize Saiku path picker.
     */
    private void initializeSaikuPath() {
        final JFilePicker saikuPath = new JFilePicker(Messages.getString("OptionWizard.65"),
                localPropertiesService.getValue(EarthProperty.SAIKU_SERVER_FOLDER),
                Messages.getString("OptionWizard.66"), DlgMode.MODE_OPEN);
        saikuPath.setFolderChooser();
        
        saikuPath.addChangeListener(new DocumentListener() {
            @Override
            public void removeUpdate(DocumentEvent e) {
                // Not used
            }

            @Override
            public void insertUpdate(DocumentEvent e) {
                showSaikuWarning();
            }

            @Override
            public void changedUpdate(DocumentEvent e) {
                // Not used
            }

            private void showSaikuWarning() {
                final File saikuFolder = new File(saikuPath.getSelectedFilePath());
                if (!saikuService.isSaikuFolder(saikuFolder)) {
                    JOptionPane.showMessageDialog(PropertiesDialog.this, 
                            Messages.getString("OptionWizard.27"),
                            Messages.getString("OptionWizard.28"), 
                            JOptionPane.INFORMATION_MESSAGE);
                    saikuPath.getTextField().setBackground(CollectEarthWindow.ERROR_COLOR);
                } else {
                    saikuPath.getTextField().setBackground(Color.white);
                }
            }
        });
        
        propertyToComponent.put(EarthProperty.SAIKU_SERVER_FOLDER, new JComponent[] { saikuPath });
    }
    
    /**
     * Initialize template pickers.
     */
    private void initializeTemplatePickers() {
        // KML template picker
        final JFilePicker kmlTemplatePath = new JFilePicker(Messages.getString("OptionWizard.79"),
                localPropertiesService.getValue(EarthProperty.KML_TEMPLATE_KEY), 
                Messages.getString("OptionWizard.80"), DlgMode.MODE_OPEN);
        kmlTemplatePath.addFileTypeFilter(".fmt", Messages.getString("OptionWizard.82"), true);
        propertyToComponent.put(EarthProperty.KML_TEMPLATE_KEY, new JComponent[] { kmlTemplatePath });

        // HTML balloon template picker
        final JFilePicker htmlBalloonPath = new JFilePicker(Messages.getString("OptionWizard.83"),
                localPropertiesService.getValue(EarthProperty.BALLOON_TEMPLATE_KEY),
                Messages.getString("OptionWizard.84"), DlgMode.MODE_OPEN);
        htmlBalloonPath.addFileTypeFilter(".html,.htm", Messages.getString("OptionWizard.86"), true);
        propertyToComponent.put(EarthProperty.BALLOON_TEMPLATE_KEY, new JComponent[] { htmlBalloonPath });

        // IDM file picker
        final JFilePicker idmPath = new JFilePicker(Messages.getString("OptionWizard.87"),
                localPropertiesService.getImdFile(), 
                Messages.getString("OptionWizard.88"), DlgMode.MODE_OPEN);
        idmPath.addFileTypeFilter(".xml", Messages.getString("OptionWizard.90"), true);
        propertyToComponent.put(EarthProperty.METADATA_FILE, new JComponent[] { idmPath });

        // Survey name text field (disabled)
        final JTextField surveyNameTextField = new JTextField(
                localPropertiesService.getValue(EarthProperty.SURVEY_NAME));
        surveyNameTextField.setEnabled(false);
        propertyToComponent.put(EarthProperty.SURVEY_NAME, new JComponent[] { surveyNameTextField });
    }
    
    /**
     * Initialize database options.
     */
    private void initializeDatabaseOptions() {
        // Operation mode
        final JRadioButton instanceTypeServer = new JRadioButton(Messages.getString("OptionWizard.91"));
        instanceTypeServer.setSelected(localPropertiesService.getOperationMode().equals(OperationMode.SERVER_MODE));
        instanceTypeServer.setName(EarthConstants.OperationMode.SERVER_MODE.name());

        final JRadioButton instanceTypeClient = new JRadioButton(Messages.getString("OptionWizard.92"));
        instanceTypeClient.setSelected(localPropertiesService.getOperationMode().equals(OperationMode.CLIENT_MODE));
        instanceTypeClient.setName(EarthConstants.OperationMode.CLIENT_MODE.name());
        
        propertyToComponent.put(EarthProperty.OPERATION_MODE,
                new JComponent[] { instanceTypeServer, instanceTypeClient });

        // Server host and port
        final JTextField collectEarthServerIp = new JTextField(localPropertiesService.getValue(EarthProperty.HOST_KEY));
        propertyToComponent.put(EarthProperty.HOST_KEY, new JComponent[] { collectEarthServerIp });

        final JTextField collectEarthServerIpPort = new JTextField(localPropertiesService.getPort());
        final JTextField collectEarthServerLocalPort = new JTextField(
                localPropertiesService.getValue(EarthProperty.HOST_PORT_KEY));
        propertyToComponent.put(EarthProperty.HOST_PORT_KEY,
                new JComponent[] { collectEarthServerIpPort, collectEarthServerLocalPort });

        // Database driver
        final JRadioButton sqliteDbType = new JRadioButton(Messages.getString("OptionWizard.93"));
        sqliteDbType.setSelected(localPropertiesService.getCollectDBDriver().equals(CollectDBDriver.SQLITE));
        sqliteDbType.setName(CollectDBDriver.SQLITE.name());

        final JRadioButton postgresDbType = new JRadioButton(Messages.getString("OptionWizard.94"));
        boolean usingPostgreSQL = localPropertiesService.getCollectDBDriver().equals(CollectDBDriver.POSTGRESQL);
        postgresDbType.setSelected(usingPostgreSQL);
        postgresDbType.setName(CollectDBDriver.POSTGRESQL.name());
        
        propertyToComponent.put(EarthProperty.DB_DRIVER, new JComponent[] { sqliteDbType, postgresDbType });

        // DB connection settings with real-time validation
        final JTextField dbUserName = new JTextField(localPropertiesService.getValue(EarthProperty.DB_USERNAME));
        dbUserName.setToolTipText("Database username for PostgreSQL connection");
        addRealTimeValidation(dbUserName, createDatabaseConnectionValidator());
        propertyToComponent.put(EarthProperty.DB_USERNAME, new JComponent[] { dbUserName });

        final JTextField dbPassword = new JTextField(localPropertiesService.getValue(EarthProperty.DB_PASSWORD));
        dbPassword.setToolTipText("Database password for PostgreSQL connection");
        addRealTimeValidation(dbPassword, createDatabaseConnectionValidator());
        propertyToComponent.put(EarthProperty.DB_PASSWORD, new JComponent[] { dbPassword });

        final JTextField dbName = new JTextField(localPropertiesService.getValue(EarthProperty.DB_NAME));
        dbName.setToolTipText("Name of the PostgreSQL database to connect to");
        addRealTimeValidation(dbName, createDatabaseConnectionValidator());
        propertyToComponent.put(EarthProperty.DB_NAME, new JComponent[] { dbName });

        final JTextField dbHost = new JTextField(localPropertiesService.getValue(EarthProperty.DB_HOST));
        dbHost.setToolTipText("Hostname or IP address of the PostgreSQL server");
        addRealTimeValidation(dbHost, createDatabaseConnectionValidator());
        propertyToComponent.put(EarthProperty.DB_HOST, new JComponent[] { dbHost });

        final JTextField dbPort = new JTextField(localPropertiesService.getValue(EarthProperty.DB_PORT));
        dbPort.setToolTipText("Port number for PostgreSQL connection (default: 5432)");
        addRealTimeValidation(dbPort, createPortValidator());
        propertyToComponent.put(EarthProperty.DB_PORT, new JComponent[] { dbPort });
    }
    
    /**
     * Create default GridBagConstraints for responsive layouts.
     */
    private GridBagConstraints createDefaultConstraints() {
        GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridx = 0;
        constraints.gridy = 0;
        constraints.anchor = GridBagConstraints.NORTHWEST;
        constraints.insets = new Insets(8, 8, 8, 8); // Consistent spacing
        constraints.weightx = 1.0; // Allow horizontal expansion
        constraints.fill = GridBagConstraints.HORIZONTAL;
        return constraints;
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
     * Verifies that the text is a valid URL and contains required placeholders.
     */
    private static class UrlPlaceholderVerifier extends InputVerifier {
        @Override
        public boolean verify(JComponent input) {
            String text = ((JTextField) input).getText().trim();
            if (text.isEmpty()) {
                return true; // allow empty
            }
            try {
                new URL(text);
            } catch (MalformedURLException e) {
                showError(input, "Invalid URL format.");
                return false;
            }
            
            boolean hasLatitude = text.contains("LATITUDE");
            boolean hasLongitude = text.contains("LONGITUDE");
            boolean hasPlotId = text.contains("PLOT_ID");
            boolean hasGeoJson = text.contains("GEOJSON");
            
            if (!hasLatitude && !hasLongitude && !hasPlotId && !hasGeoJson) {
                showWarning(input, "At least one of these parameters should be specified in the URL: LATITUDE, LONGITUDE, PLOT_ID or GEOJSON.");
                return true; // Allow saving with warning
            } else if ( 
            		(hasLatitude && !hasLongitude)
        	         || 
        	         (!hasLatitude && hasLongitude)
            ){
                showWarning(input, "You should set bothe LATITUDE and LONGITUDE.");
                return true; // Allow saving with warning
            }
            return true;
        }

        private void showError(JComponent input, String message) {
            // Set visual feedback immediately
            input.setBackground(new Color(255, 220, 220));
            input.setToolTipText(message);
            
            // Show user-friendly dialog
            JOptionPane.showMessageDialog(
                    input.getParent(),
                    message + "\n\nPlease ensure your URL follows this format:\nhttps://example.com/map?lat=LATITUDE&lon=LONGITUDE",
                    "Invalid Map URL",
                    JOptionPane.ERROR_MESSAGE);
            input.requestFocusInWindow();
        }
        
        private void showWarning(JComponent input, String message) {
            // Set visual feedback for warning
            input.setBackground(new Color(255, 250, 200)); // Light yellow
            input.setToolTipText(message);
            
            // Show informative warning dialog
            String detailedMessage = message + 
                "\n\nRecommended placeholders:" +
                "\n• LATITUDE, LONGITUDE - for coordinate-based maps" +
                "\n• PLOT_ID - for plot identifier-based maps" +
                "\n• GEOJSON - for geometry-based maps" +
                "\n\nExample: https://maps.example.com?lat=LATITUDE&lon=LONGITUDE&plot=PLOT_ID";
                
            JOptionPane.showMessageDialog(
                    input.getParent(),
                    detailedMessage,
                    "Map URL Configuration",
                    JOptionPane.WARNING_MESSAGE);
        }
    }

    private boolean validateFields() {
        for (JComponent[] comps : propertyToComponent.values()) {
            JComponent comp = comps[0];
            InputVerifier verifier = comp.getInputVerifier();
            if (verifier != null && !verifier.verify(comp)) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * Adds real-time validation to a text field with visual feedback.
     */
    private void addRealTimeValidation(JTextField textField, InputVerifier validator) {
        textField.getDocument().addDocumentListener(new DocumentListener() {
            @Override
            public void changedUpdate(DocumentEvent e) { validateField(); }
            @Override
            public void removeUpdate(DocumentEvent e) { validateField(); }
            @Override
            public void insertUpdate(DocumentEvent e) { validateField(); }
            
            private void validateField() {
                boolean isValid = validator.verify(textField);
                if (isValid) {
                    textField.setBackground(Color.WHITE);
                    textField.setToolTipText(null);
                } else {
                    textField.setBackground(new Color(255, 220, 220)); // Light red
                    textField.setToolTipText("Invalid input - please check the format");
                }
            }
        });
    }
    
    /**
     * Creates a database connection validator.
     */
    private InputVerifier createDatabaseConnectionValidator() {
        return new InputVerifier() {
            @Override
            public boolean verify(JComponent input) {
                String text = ((JTextField) input).getText().trim();
                return !text.isEmpty(); // Basic non-empty validation
            }
        };
    }
    
    /**
     * Creates a port number validator.
     */
    private InputVerifier createPortValidator() {
        return new InputVerifier() {
            @Override
            public boolean verify(JComponent input) {
                String text = ((JTextField) input).getText().trim();
                if (text.isEmpty()) return true; // Allow empty for optional fields
                try {
                    int port = Integer.parseInt(text);
                    return port > 0 && port <= 65535;
                } catch (NumberFormatException e) {
                    return false;
                }
            }
        };
    }
    
    /**
     * Creates a URL validator.
     */
    private InputVerifier createUrlValidator() {
        return new InputVerifier() {
            @Override
            public boolean verify(JComponent input) {
                String text = ((JTextField) input).getText().trim();
                if (text.isEmpty()) return true; // Allow empty for optional fields
                try {
                    java.net.URI uri = java.net.URI.create(text);
                    return uri.getScheme() != null && 
                           (uri.getScheme().equals("http") || uri.getScheme().equals("https")) &&
                           uri.getHost() != null;
                } catch (Exception e) {
                    return false;
                }
            }
        };
    }
}
