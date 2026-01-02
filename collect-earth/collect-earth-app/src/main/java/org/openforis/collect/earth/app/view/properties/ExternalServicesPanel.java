package org.openforis.collect.earth.app.view.properties;

import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;

import javax.swing.BorderFactory;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JTextField;

import org.apache.commons.lang3.StringUtils;
import org.jdesktop.swingx.JXDatePicker;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.Messages;

/**
 * Panel for configuring external mapping services and integrations.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class ExternalServicesPanel extends AbstractPropertyPanel {

    private static final long serialVersionUID = 1L;
    private static final String START_OF_LANDSAT_AND_MODIS = "2000-01-01";

    // GEE App components
    private JCheckBox openGeeAppCheckbox;
    private JCheckBox specifyStartAndEndGeeApp;
    private JXDatePicker geeAppFromDate;
    private JXDatePicker geeAppToDate;
    private JPanel geeAppDatePanel;

    // Other services
    private JCheckBox openEarthMapCheckbox;
    private JCheckBox openEsriWaybackCheckbox;

    // Planet Maps panel and components
    private JPanel planetPanel;
    private JCheckBox openPlanetCheckbox;
    private JPasswordField planetApiKeyField;
    private JCheckBox useTfoCheckbox;
    private JComboBox<String> planetTfoFromMonth;
    private JComboBox<String> planetTfoToMonth;
    private JPanel planetTfoMonthPanel;

    private JCheckBox openSecureWatchCheckbox;
    private JTextField secureWatchUrlField;
    private JTextField extraUrlField;

    /**
     * Creates a new external services panel.
     */
    public ExternalServicesPanel(LocalPropertiesService localPropertiesService,
                                 HashMap<Enum<?>, JComponent[]> propertyToComponent,
                                 HashMap<JComponent, JLabel> componentToRowLabel) {
        super(localPropertiesService, propertyToComponent, componentToRowLabel);
        buildPanel();
    }

    @Override
    protected void buildPanel() {
        initializeComponents();
        layoutComponents();
        setupListeners();
    }

    private void initializeComponents() {
        // Google Earth Engine App
        openGeeAppCheckbox = componentFactory.createCheckbox("OptionWizard.136", EarthProperty.OPEN_GEE_APP);
        registerComponent(EarthProperty.OPEN_GEE_APP, openGeeAppCheckbox);

        specifyStartAndEndGeeApp = new JCheckBox(Messages.getString("OptionWizard.120"));

        // Date pickers for GEE App
        geeAppFromDate = componentFactory.createDatePicker(EarthProperty.GEEAPP_FROM_DATE,
                "Sets the starting date to analyze imagery in the GEE App");
        registerComponent(EarthProperty.GEEAPP_FROM_DATE, geeAppFromDate);

        geeAppToDate = componentFactory.createDatePicker(EarthProperty.GEEAPP_TO_DATE,
                "Sets the end date to analyze imagery in the GEE App");
        registerComponent(EarthProperty.GEEAPP_TO_DATE, geeAppToDate);

        // Date panel container
        geeAppDatePanel = new JPanel();
        geeAppDatePanel.add(new JLabel(Messages.getString("OptionWizard.121")));
        geeAppDatePanel.add(geeAppFromDate);
        geeAppDatePanel.add(new JLabel(Messages.getString("OptionWizard.122")));
        geeAppDatePanel.add(geeAppToDate);

        // Earth Map
        openEarthMapCheckbox = componentFactory.createCheckbox("OptionWizard.105", EarthProperty.OPEN_EARTH_MAP);
        registerComponent(EarthProperty.OPEN_EARTH_MAP, openEarthMapCheckbox);

        // ESRI World Imagery Wayback
        openEsriWaybackCheckbox = componentFactory.createCheckbox("OptionWizard.144", EarthProperty.OPEN_ESRI_WAYBACK);
        registerComponent(EarthProperty.OPEN_ESRI_WAYBACK, openEsriWaybackCheckbox);

        // Planet Maps - create components
        openPlanetCheckbox = componentFactory.createCheckbox("OptionWizard.100", EarthProperty.OPEN_PLANET_MAPS);
        registerComponent(EarthProperty.OPEN_PLANET_MAPS, openPlanetCheckbox);

        planetApiKeyField = componentFactory.createPasswordField(EarthProperty.PLANET_MAPS_KEY);
        planetApiKeyField.setEnabled(openPlanetCheckbox.isSelected());
        registerComponent(EarthProperty.PLANET_MAPS_KEY, planetApiKeyField);

        // Planet TFO (Tropical Forest Observatory) mode - uses same API key as Daily
        useTfoCheckbox = componentFactory.createCheckbox("OptionWizard.140", EarthProperty.PLANET_MAPS_USE_TFO);
        useTfoCheckbox.setEnabled(openPlanetCheckbox.isSelected());
        registerComponent(EarthProperty.PLANET_MAPS_USE_TFO, useTfoCheckbox);

        // Month selectors for Planet TFO (September 2020 to previous month, format YYYY-MM)
        String[] availableMonths = generateTfoMonthOptions();

        // From month: "Oldest" as default (empty value), then all months
        planetTfoFromMonth = new JComboBox<>();
        planetTfoFromMonth.addItem("Oldest");
        for (String month : availableMonths) {
            planetTfoFromMonth.addItem(month);
        }
        planetTfoFromMonth.setToolTipText("Sets the starting month for Planet TFO comparison (Oldest = earliest available)");
        planetTfoFromMonth.setEnabled(openPlanetCheckbox.isSelected() && useTfoCheckbox.isSelected());
        planetTfoFromMonth.setSelectedIndex(0); // Default to "Oldest"
        // Set saved value if exists
        String savedFromMonth = localPropertiesService.getPlanetTfoDateFrom();
        if (StringUtils.isNotBlank(savedFromMonth)) {
            planetTfoFromMonth.setSelectedItem(savedFromMonth);
        }
        registerComponent(EarthProperty.PLANET_TFO_DATE_FROM, planetTfoFromMonth);

        // To month: "Latest" as default (empty value), then all months
        planetTfoToMonth = new JComboBox<>();
        planetTfoToMonth.addItem("Latest");
        for (String month : availableMonths) {
            planetTfoToMonth.addItem(month);
        }
        planetTfoToMonth.setToolTipText("Sets the end month for Planet TFO comparison (Latest = most recent available)");
        planetTfoToMonth.setEnabled(openPlanetCheckbox.isSelected() && useTfoCheckbox.isSelected());
        planetTfoToMonth.setSelectedIndex(0); // Default to "Latest"
        // Set saved value if exists
        String savedToMonth = localPropertiesService.getPlanetTfoDateTo();
        if (StringUtils.isNotBlank(savedToMonth)) {
            planetTfoToMonth.setSelectedItem(savedToMonth);
        }
        registerComponent(EarthProperty.PLANET_TFO_DATE_TO, planetTfoToMonth);

        // TFO month panel container
        planetTfoMonthPanel = new JPanel();
        planetTfoMonthPanel.add(new JLabel(Messages.getString("OptionWizard.142")));
        planetTfoMonthPanel.add(planetTfoFromMonth);
        planetTfoMonthPanel.add(new JLabel(Messages.getString("OptionWizard.143")));
        planetTfoMonthPanel.add(planetTfoToMonth);
        planetTfoMonthPanel.setVisible(openPlanetCheckbox.isSelected() && useTfoCheckbox.isSelected());

        // Create Planet panel with titled border to group all Planet-related components
        planetPanel = createPlanetPanel();

        // Maxar SecureWatch
        openSecureWatchCheckbox = componentFactory.createCheckbox("OptionWizard.102", EarthProperty.OPEN_MAXAR_SECUREWATCH);
        registerComponent(EarthProperty.OPEN_MAXAR_SECUREWATCH, openSecureWatchCheckbox);

        secureWatchUrlField = componentFactory.createTextField(EarthProperty.MAXAR_SECUREWATCH_URL);
        secureWatchUrlField.setEnabled(localPropertiesService.isSecureWatchSupported());
        registerComponent(EarthProperty.MAXAR_SECUREWATCH_URL, secureWatchUrlField);

        // Extra Map URL
        extraUrlField = componentFactory.createTextFieldWithPlaceholder(
                EarthProperty.EXTRA_MAP_URL,
                "https://www.extramap.org/lat=LATITUDE&long=LONGITUDE&id=PLOT_ID",
                "Custom map service URL with placeholders for LATITUDE, LONGITUDE, PLOT_ID, or GEOJSON"
        );
        extraUrlField.setInputVerifier(PropertyValidators.urlPlaceholderVerifier());
        registerComponent(EarthProperty.EXTRA_MAP_URL, extraUrlField);

        // Initialize visibility based on saved properties
        initializeVisibility();
    }

    private void initializeVisibility() {
        boolean hasFromDate = StringUtils.isNotBlank(localPropertiesService.getValue(EarthProperty.GEEAPP_FROM_DATE));
        specifyStartAndEndGeeApp.setSelected(hasFromDate);
        geeAppDatePanel.setVisible(hasFromDate && openGeeAppCheckbox.isSelected());
        specifyStartAndEndGeeApp.setVisible(openGeeAppCheckbox.isSelected());
    }

    private void layoutComponents() {
        GridBagConstraints constraints = GridBagConstraintsBuilder.createDefault();

        // GEE App checkbox
        add(openGeeAppCheckbox, constraints);

        // Specify date range checkbox
        constraints = new GridBagConstraintsBuilder()
                .gridx(1)
                .gridy(0)
                .build();
        add(specifyStartAndEndGeeApp, constraints);

        // GEE App date panel
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(1)
                .gridwidth(4)
                .build();
        add(geeAppDatePanel, constraints);

        // Earth Map
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(2)
                .build();
        add(openEarthMapCheckbox, constraints);

        // ESRI World Imagery Wayback
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(3)
                .build();
        add(openEsriWaybackCheckbox, constraints);

        // Planet Maps panel (contains all Planet-related components)
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(4)
                .gridwidth(4)
                .fill(GridBagConstraints.HORIZONTAL)
                .build();
        add(planetPanel, constraints);

        // Maxar SecureWatch
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(5)
                .gridwidth(2)
                .build();
        add(openSecureWatchCheckbox, constraints);

        // Maxar URL
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(6)
                .build();
        add(new JLabel(Messages.getString("OptionWizard.1021")), constraints);

        constraints = new GridBagConstraintsBuilder()
                .gridx(1)
                .gridy(6)
                .build();
        add(secureWatchUrlField, constraints);

        // Extra Map URL label
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(7)
                .gridwidth(2)
                .build();
        JLabel extraLabel = new JLabel(Messages.getString("OptionWizard.103"));
        extraLabel.setToolTipText("Custom map service URL with placeholders for LATITUDE, LONGITUDE, PLOT_ID, or GEOJSON");
        add(extraLabel, constraints);

        // Extra Map URL field
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(8)
                .gridwidth(2)
                .build();
        add(extraUrlField, constraints);
    }

    private void setupListeners() {
        // GEE App checkbox toggles date range visibility
        openGeeAppCheckbox.addActionListener(e -> {
            boolean geeAppSelected = openGeeAppCheckbox.isSelected();
            boolean dateRangeSelected = specifyStartAndEndGeeApp.isSelected();

            geeAppDatePanel.setVisible(geeAppSelected && dateRangeSelected);
            specifyStartAndEndGeeApp.setVisible(geeAppSelected);

            if (!geeAppSelected) {
                specifyStartAndEndGeeApp.setSelected(false);
            }
        });

        // Date range checkbox toggles date panel
        specifyStartAndEndGeeApp.addActionListener(e -> {
            if (specifyStartAndEndGeeApp.isSelected()) {
                initializeDatePickersWithDefaults();
                geeAppDatePanel.setVisible(true);
            } else {
                clearDatePickers();
                geeAppDatePanel.setVisible(false);
            }
        });

        // Planet checkbox toggles API key field and TFO options
        openPlanetCheckbox.addActionListener(e -> {
            boolean planetSelected = openPlanetCheckbox.isSelected();
            boolean tfoSelected = useTfoCheckbox.isSelected();

            planetApiKeyField.setEnabled(planetSelected);
            useTfoCheckbox.setEnabled(planetSelected);
            planetTfoFromMonth.setEnabled(planetSelected && tfoSelected);
            planetTfoToMonth.setEnabled(planetSelected && tfoSelected);
            planetTfoMonthPanel.setVisible(planetSelected && tfoSelected);

            if (!planetSelected) {
                useTfoCheckbox.setSelected(false);
            }
        });

        // TFO checkbox toggles between Daily and TFO mode
        useTfoCheckbox.addActionListener(e -> {
            boolean tfoSelected = useTfoCheckbox.isSelected();
            boolean planetSelected = openPlanetCheckbox.isSelected();

            // Month panel visible only when TFO is selected
            planetTfoFromMonth.setEnabled(planetSelected && tfoSelected);
            planetTfoToMonth.setEnabled(planetSelected && tfoSelected);
            planetTfoMonthPanel.setVisible(planetSelected && tfoSelected);
        });

        // SecureWatch checkbox toggles URL field
        openSecureWatchCheckbox.addActionListener(e ->
                secureWatchUrlField.setEnabled(openSecureWatchCheckbox.isSelected()));
    }

    private void initializeDatePickersWithDefaults() {
        SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd");
        try {
            if (geeAppFromDate.getDate() == null) {
                geeAppFromDate.setDate(dateFormat.parse(START_OF_LANDSAT_AND_MODIS));
            }
            if (geeAppToDate.getDate() == null) {
                geeAppToDate.setDate(new Date());
            }
        } catch (ParseException e) {
            logger.error("Error parsing date", e);
        }
    }

    private void clearDatePickers() {
        geeAppFromDate.setDate(null);
        geeAppToDate.setDate(null);
    }

    /**
     * Generates an array of month options for the TFO date selectors.
     * Range: September 2020 to the previous month, format YYYY-MM
     */
    private String[] generateTfoMonthOptions() {
        List<String> months = new ArrayList<>();

        // TFO imagery starts from September 2020
        final int startYear = 2020;
        final int startMonth = 9; // September

        // Get current date to calculate end (previous month)
        Calendar now = Calendar.getInstance();
        int currentYear = now.get(Calendar.YEAR);
        int currentMonth = now.get(Calendar.MONTH) + 1; // Calendar.MONTH is 0-based

        // Calculate previous month
        int endYear = currentYear;
        int endMonth = currentMonth - 1;
        if (endMonth < 1) {
            endMonth = 12;
            endYear--;
        }

        // Generate all months from start to end
        int year = startYear;
        int month = startMonth;

        while (year < endYear || (year == endYear && month <= endMonth)) {
            // Format as YYYY-MM
            String monthStr = String.format("%d-%02d", year, month);
            months.add(monthStr);

            // Move to next month
            month++;
            if (month > 12) {
                month = 1;
                year++;
            }
        }

        return months.toArray(new String[0]);
    }

    /**
     * Creates a bordered panel containing all Planet-related components.
     */
    private JPanel createPlanetPanel() {
        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createTitledBorder(
                BorderFactory.createEtchedBorder(),
                "Planet NICFI"));

        GridBagConstraints gbc = new GridBagConstraints();
        gbc.insets = new Insets(2, 5, 2, 5);
        gbc.anchor = GridBagConstraints.WEST;

        // Row 0: Enable Planet checkbox
        gbc.gridx = 0;
        gbc.gridy = 0;
        gbc.gridwidth = 2;
        panel.add(openPlanetCheckbox, gbc);

        // Row 1: API Key label and field
        gbc.gridx = 0;
        gbc.gridy = 1;
        gbc.gridwidth = 1;
        panel.add(new JLabel(Messages.getString("OptionWizard.101")), gbc);

        gbc.gridx = 1;
        gbc.gridy = 1;
        gbc.fill = GridBagConstraints.HORIZONTAL;
        gbc.weightx = 1.0;
        panel.add(planetApiKeyField, gbc);

        // Row 2: TFO checkbox
        gbc.gridx = 0;
        gbc.gridy = 2;
        gbc.gridwidth = 2;
        gbc.fill = GridBagConstraints.NONE;
        gbc.weightx = 0;
        panel.add(useTfoCheckbox, gbc);

        // Row 3: TFO month panel
        gbc.gridx = 0;
        gbc.gridy = 3;
        gbc.gridwidth = 2;
        panel.add(planetTfoMonthPanel, gbc);

        return panel;
    }

    // ========== Getters ==========

    public JCheckBox getOpenGeeAppCheckbox() {
        return openGeeAppCheckbox;
    }

    public JCheckBox getOpenEarthMapCheckbox() {
        return openEarthMapCheckbox;
    }

    public JCheckBox getOpenEsriWaybackCheckbox() {
        return openEsriWaybackCheckbox;
    }

    public JCheckBox getOpenPlanetCheckbox() {
        return openPlanetCheckbox;
    }

    public JCheckBox getOpenSecureWatchCheckbox() {
        return openSecureWatchCheckbox;
    }
}
