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
import javax.swing.JTabbedPane;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import javax.swing.ScrollPaneConstants;
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
import java.awt.Color;

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
        this.setSize(new Dimension(600, 620));
        this.setModal(true);
        this.setResizable(false);
        
        try {
            initializeInputs();
            buildMainPane();
            centerWindow();
        } catch (Exception e) {
            logger.error("Error initializing properties dialog", e);
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
        panel.add(getOptionTabs(), BorderLayout.CENTER);
        
        final JPanel buttonPanel = new JPanel();
        buttonPanel.add(getApplyChangesButton());
        buttonPanel.add(getCancelButton());
        panel.add(buttonPanel, BorderLayout.PAGE_END);
        
        this.add(panel);
    }

    /**
     * Create the tabbed pane with all option panels.
     */
    private JTabbedPane getOptionTabs() {
        final JTabbedPane tabbedPane = new JTabbedPane();
        tabbedPane.setSize(550, 300);
        
        // Add tabs for different setting groups
        tabbedPane.addTab(Messages.getString("OptionWizard.31"), getSampleDataPanel());
        tabbedPane.addTab(Messages.getString("OptionWizard.32"), getPlotOptionsPanel());
        tabbedPane.addTab(Messages.getString("OptionWizard.34"), getIntegrationsPanel());
        tabbedPane.addTab(Messages.getString("OptionWizard.104"), getBrowsersOptionsPanel());
        tabbedPane.addTab(Messages.getString("OptionWizard.25"), getOperationModePanelScroll());
        tabbedPane.addTab(Messages.getString("OptionWizard.40"), getProjectsPanelScroll());

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
                            new Thread("Applying properties dialog") {
                                @Override
                                public void run() {
                                	// Validate before saving
                                    if (validateFields()) {
	                                    savePropertyValues();
	                                    if (isRestartRequired()) {
	                                        restartEarth();
	                                    } else {
	                                        EarthApp.executeKmlLoadAsynchronously(PropertiesDialog.this);
	                                    }
                                    }
                                }
                            }.start();
                        }
                    });
        }
        return applyChanges;
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
     * Create list of projects.
     */
    private JList<String> createProjectsList() {
        List<String> projectNames = new ArrayList<>(projectsService.getProjectList().keySet());
        Collections.sort(projectNames);
        
        final JList<String> projectsList = new JList<>(projectNames.toArray(new String[0]));
        projectsList.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        projectsList.setLayoutOrientation(JList.VERTICAL);
        projectsList.setVisibleRowCount(-1);
        
        return projectsList;
    }
    
    /**
     * Create button for opening selected project.
     */
    private JButton createOpenProjectButton(JList<String> projectsList) {
        final JButton openProject = new JButton(Messages.getString("OptionWizard.56"));
        openProject.addActionListener(new ApplyOptionChangesListener(this, localPropertiesService) {
            @Override
            protected void applyProperties() {
                if( openSelectedProject(projectsList) )  restartEarth();
            }
        });
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
        final GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridx = 0;
        constraints.gridy = 0;
        constraints.ipady = 15;
        constraints.ipadx = 0;
        constraints.anchor = GridBagConstraints.LINE_START;
        constraints.insets = new Insets(0, -10, 0, -10);
        constraints.fill = GridBagConstraints.BOTH;

        // Plot shape selector
        JLabel label = new JLabel("Plot shape");
        panel.add(label, constraints);

        constraints.gridx = 1;
        JComboBox<SAMPLE_SHAPE> plotShape = (JComboBox<SAMPLE_SHAPE>) propertyToComponent.get(EarthProperty.SAMPLE_SHAPE)[0];
        panel.add(plotShape, constraints);

        // Number of points
        constraints.gridx = 0;
        constraints.gridy++;
        label = new JLabel(Messages.getString("OptionWizard.35"));
        panel.add(label, constraints);

        constraints.gridx = 1;
        JComboBox<ComboBoxItem> numberPoints = (JComboBox<ComboBoxItem>) propertyToComponent
                .get(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT)[0];
        panel.add(numberPoints, constraints);

        // Distance between points
        constraints.gridx = 0;
        constraints.gridy++;
        JLabel distanceOrRadiusLabel = new JLabel(Messages.getString("OptionWizard.36"));
        panel.add(distanceOrRadiusLabel, constraints);

        constraints.gridx = 1;
        JComboBox<String> distanceBetweenPoints = (JComboBox<String>) propertyToComponent
                .get(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS)[0];
        panel.add(new JScrollPane(distanceBetweenPoints), constraints);

        // Distance to frame
        constraints.gridx = 0;
        constraints.gridy++;
        label = new JLabel(Messages.getString("OptionWizard.37"));
        panel.add(label, constraints);
        
        constraints.gridx = 1;
        JComboBox<String> distanceToFrame = (JComboBox<String>) propertyToComponent
                .get(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES)[0];
        panel.add(new JScrollPane(distanceToFrame), constraints);

        // Dots side
        constraints.gridx = 0;
        constraints.gridy++;
        label = new JLabel(Messages.getString("OptionWizard.95"));
        panel.add(label, constraints);
        
        constraints.gridx = 1;
        JComboBox<String> dotsSide = (JComboBox<String>) propertyToComponent.get(EarthProperty.INNER_SUBPLOT_SIDE)[0];
        panel.add(new JScrollPane(dotsSide), constraints);

        // Central plot side
        constraints.gridx = 0;
        constraints.gridy++;
        label = new JLabel("Central plot side");
        panel.add(label, constraints);
        
        constraints.gridx = 1;
        JComboBox<String> largeCentralPlotSide = (JComboBox<String>) propertyToComponent.get(EarthProperty.LARGE_CENTRAL_PLOT_SIDE)[0];
        panel.add(new JScrollPane(largeCentralPlotSide), constraints);

        // Distance between plots in cluster
        constraints.gridx = 0;
        constraints.gridy++;
        label = new JLabel("Distance between plots in cluster");
        panel.add(label, constraints);
        
        constraints.gridx = 1;
        JComboBox<String> plotDistanceInCluster = (JComboBox<String>) propertyToComponent
                .get(EarthProperty.DISTANCE_BETWEEN_PLOTS)[0];
        panel.add(new JScrollPane(plotDistanceInCluster), constraints);

        // Area display
        constraints.gridx = 0;
        constraints.gridy++;
        JLabel area = new JLabel(
                "Area (hectares)  :  " + calculateArea(numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide));
        panel.add(area, constraints);

        // Set up action listeners
        ActionListener calculateAreasListener = e -> 
            area.setText("Area (hectares)  :  " + calculateArea(numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide));

        plotShape.addActionListener(e ->
                handleVisibilityPlotLayout(plotShape, numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide,
                        plotDistanceInCluster, area, distanceOrRadiusLabel, largeCentralPlotSide)
        );

        numberPoints.addActionListener(calculateAreasListener);
        distanceBetweenPoints.addActionListener(calculateAreasListener);
        distanceToFrame.addActionListener(calculateAreasListener);

        // Initialize visibility
        handleVisibilityPlotLayout(plotShape, numberPoints, distanceBetweenPoints, distanceToFrame, dotsSide,
                plotDistanceInCluster, area, distanceOrRadiusLabel, largeCentralPlotSide);

        return panel;
    }

    /**
     * Handle visibility of plot layout components based on selected shape.
     */
    public void handleVisibilityPlotLayout(JComboBox<SAMPLE_SHAPE> plotShape, JComboBox<ComboBoxItem> numberPoints, 
            JComboBox<String> distanceBetweenPoints, JComboBox<String> distanceToFrame, JComboBox<String> dotsSide, 
            JComboBox<String> distanceBetweenPlots, JLabel area, JLabel distanceOrRadiusLabel, 
            JComboBox<String> largeCentralPlotSide) {
        
        // First, disable all components
        numberPoints.setEnabled(false);
        distanceBetweenPoints.setEnabled(false);
        distanceToFrame.setEnabled(false);
        dotsSide.setEnabled(false);
        area.setVisible(false);
        distanceBetweenPlots.setVisible(false);
        distanceBetweenPlots.setEnabled(false);
        largeCentralPlotSide.setVisible(false);
        largeCentralPlotSide.setEnabled(false);

        // Then enable specific components based on the selected shape
        SAMPLE_SHAPE selectedShape = (SAMPLE_SHAPE) plotShape.getSelectedItem();
        
        if (selectedShape == SAMPLE_SHAPE.SQUARE || selectedShape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT) {
            numberPoints.setEnabled(true);
            distanceBetweenPoints.setEnabled(true);
            distanceToFrame.setEnabled(true);
            dotsSide.setEnabled(true);
            area.setVisible(true);
            distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.36"));

            if (selectedShape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT) {
                largeCentralPlotSide.setVisible(true);
                largeCentralPlotSide.setEnabled(true);
            }
        } else if (selectedShape == SAMPLE_SHAPE.CIRCLE || selectedShape == SAMPLE_SHAPE.HEXAGON) {
            distanceBetweenPoints.setEnabled(true);
            dotsSide.setEnabled(true);
            numberPoints.setEnabled(true);
            distanceOrRadiusLabel.setText("Radius");
        } else if (selectedShape == SAMPLE_SHAPE.NFI_THREE_CIRCLES || selectedShape == SAMPLE_SHAPE.NFI_FOUR_CIRCLES) {
            dotsSide.setEnabled(true);
            distanceBetweenPoints.setEnabled(true);
            distanceBetweenPlots.setVisible(true);
            distanceBetweenPlots.setEnabled(true);
            distanceOrRadiusLabel.setText("Radius of the plots");
        }
    }

    /**
     * Calculate the area based on plot parameters.
     */
    private String calculateArea(JComboBox<ComboBoxItem> numberOfPoints, JComboBox<String> distanceBetweenPoints, 
            JComboBox<String> distanceToFrame, JComboBox<String> dotsSide) {
        
        double side = 0;
        try {
            int numberOfPointsI = ((ComboBoxItem) numberOfPoints.getSelectedItem()).getNumberOfPoints();
            int distanceBetweenPointsI = Integer.parseInt((String) distanceBetweenPoints.getSelectedItem());
            int distanceToFrameI = Integer.parseInt((String) distanceToFrame.getSelectedItem());

            if (numberOfPointsI == 0 || numberOfPointsI == 1) {
                // Single point or no points
                side = 2d * distanceToFrameI;
                if (oldSelectedDistance == null) {
                    oldSelectedDistance = (String) distanceBetweenPoints.getSelectedItem();
                    distanceBetweenPoints.setEnabled(false);
                }
                distanceBetweenPoints.setSelectedItem("0");

                dotsSide.setEnabled(numberOfPointsI == 1);
            } else {
                // Multiple points
                if (oldSelectedDistance != null) {
                    distanceBetweenPoints.setSelectedItem(oldSelectedDistance);
                    oldSelectedDistance = null;
                }

                distanceBetweenPoints.setEnabled(true);
                distanceToFrame.setEnabled(true);
                dotsSide.setEnabled(true);

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
        panel.add(new JLabel("Default: 5432"), constraints);

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
        JButton button = new JButton("Test Connection");
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
        final GridBagConstraints constraints = createDefaultConstraints();
        constraints.fill = GridBagConstraints.BOTH;

        // File picker for sample plots CSV
        final JFilePicker refreshTableOnFileChange = getFilePickerSamplePlots(samplePlots);
        panel.add(refreshTableOnFileChange, constraints);

        // Table of sample plots
        samplePlots.setFillsViewportHeight(true);
        constraints.gridy = 1;
        constraints.weightx = 1.0;
        constraints.weighty = 1.0;
        constraints.gridwidth = GridBagConstraints.REMAINDER;
        constraints.gridheight = GridBagConstraints.REMAINDER;

        samplePlots.setPreferredScrollableViewportSize(samplePlots.getPreferredSize());
        panel.add(new JScrollPane(samplePlots, ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
                ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED), constraints);

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
        final JCheckBox openGEEAppCheckbox = new JCheckBox("Google Earth Engine APP (no sign-in)");
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

        // Extra Map URL field
        final JTextField extraUrlTextField = new JTextField(
                localPropertiesService.getValue(EarthProperty.EXTRA_MAP_URL));
        extraUrlTextField.setMinimumSize(new Dimension(250, 20));
        extraUrlTextField.setInputVerifier( new UrlPlaceholderVerifier() );
     // register it for placeholder text
        PromptSupport.setPrompt(
            "https://www.extramap.org/lat=LATITUDE&long=LONGITUDE&id=PLOT_ID",
            extraUrlTextField);
       // PromptSupport.setForeground(Color.GRAY, extraUrlTextField);


        
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
     * Initialize distance-related dropdown components.
     */
    private void initializeDistanceComponents() {
        // Generate lists of numbers for distance dropdowns
        final String[] listOfNumbers = new String[1500];
        final String[] listOfNumbersFromTwo = new String[1500];

        for (int index = 0; index < listOfNumbers.length; index++) {
            listOfNumbers[index] = Integer.toString(index);
            listOfNumbersFromTwo[index] = Integer.toString(index + 2);
        }

        // Distance between sampling points
        final JComboBox<String> listOfDistanceBetweenPoints = new JComboBox<>(listOfNumbersFromTwo);
        listOfDistanceBetweenPoints.setSelectedItem(
                localPropertiesService.getValue(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS));
        listOfDistanceBetweenPoints.setAutoscrolls(true);
        propertyToComponent.put(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS,
                new JComponent[] { listOfDistanceBetweenPoints });

        // Distance between plots
        final JComboBox<String> listOfDistanceBetweenPlots = new JComboBox<>(listOfNumbersFromTwo);
        listOfDistanceBetweenPlots.setSelectedItem(
                localPropertiesService.getValue(EarthProperty.DISTANCE_BETWEEN_PLOTS));
        listOfDistanceBetweenPlots.setAutoscrolls(true);
        propertyToComponent.put(EarthProperty.DISTANCE_BETWEEN_PLOTS, 
                new JComponent[] { listOfDistanceBetweenPlots });

        // Distance to plot boundaries
        final JComboBox<String> listOfDistanceToBorder = new JComboBox<>(listOfNumbers);
        listOfDistanceToBorder.setSelectedItem(
                localPropertiesService.getValue(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES));
        listOfDistanceToBorder.setAutoscrolls(true);
        propertyToComponent.put(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, 
                new JComponent[] { listOfDistanceToBorder });

        // Inner subplot side
        final JComboBox<String> listOfSizeofSamplingDot = new JComboBox<>(listOfNumbersFromTwo);
        listOfSizeofSamplingDot.setSelectedItem(
                localPropertiesService.getValue(EarthProperty.INNER_SUBPLOT_SIDE));
        listOfSizeofSamplingDot.setAutoscrolls(true);
        propertyToComponent.put(EarthProperty.INNER_SUBPLOT_SIDE, 
                new JComponent[] { listOfSizeofSamplingDot });

        // Large central plot side
        final JComboBox<String> listOfSideOflargeCentralPlot = new JComboBox<>(listOfNumbersFromTwo);
        listOfSideOflargeCentralPlot.setSelectedItem(
                localPropertiesService.getValue(EarthProperty.LARGE_CENTRAL_PLOT_SIDE));
        listOfSideOflargeCentralPlot.setAutoscrolls(true);
        propertyToComponent.put(EarthProperty.LARGE_CENTRAL_PLOT_SIDE, 
                new JComponent[] { listOfSideOflargeCentralPlot });
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

        // DB connection settings
        final JTextField dbUserName = new JTextField(localPropertiesService.getValue(EarthProperty.DB_USERNAME));
        propertyToComponent.put(EarthProperty.DB_USERNAME, new JComponent[] { dbUserName });

        final JTextField dbPassword = new JTextField(localPropertiesService.getValue(EarthProperty.DB_PASSWORD));
        propertyToComponent.put(EarthProperty.DB_PASSWORD, new JComponent[] { dbPassword });

        final JTextField dbName = new JTextField(localPropertiesService.getValue(EarthProperty.DB_NAME));
        propertyToComponent.put(EarthProperty.DB_NAME, new JComponent[] { dbName });

        final JTextField dbHost = new JTextField(localPropertiesService.getValue(EarthProperty.DB_HOST));
        propertyToComponent.put(EarthProperty.DB_HOST, new JComponent[] { dbHost });

        final JTextField dbPort = new JTextField(localPropertiesService.getValue(EarthProperty.DB_PORT));
        propertyToComponent.put(EarthProperty.DB_PORT, new JComponent[] { dbPort });
    }
    
    /**
     * Create default GridBagConstraints.
     */
    private GridBagConstraints createDefaultConstraints() {
        GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridx = 0;
        constraints.gridy = 0;
        constraints.anchor = GridBagConstraints.LINE_START;
        constraints.insets = new Insets(5, 5, 5, 5);
        constraints.weightx = 1.0;
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
            if (!text.contains("LATITUDE") || !text.contains("LONGITUDE")) {
                showError(input, "URL must contain LATITUDE and LONGITUDE placeholders.");
                return false;
            }
            return true;
        }

        private void showError(JComponent input, String message) {
            JOptionPane.showMessageDialog(
                    input.getParent(),
                    message,
                    "Error in Extra Map URL",
                    JOptionPane.ERROR_MESSAGE);
            input.requestFocusInWindow();
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
}