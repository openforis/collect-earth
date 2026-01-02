package org.openforis.collect.earth.app.view.properties;

import java.awt.GridBagConstraints;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;

import javax.swing.JCheckBox;
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
    private JCheckBox openPlanetCheckbox;
    private JPasswordField planetApiKeyField;
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

        // Planet Maps
        openPlanetCheckbox = componentFactory.createCheckbox("OptionWizard.100", EarthProperty.OPEN_PLANET_MAPS);
        registerComponent(EarthProperty.OPEN_PLANET_MAPS, openPlanetCheckbox);

        planetApiKeyField = componentFactory.createPasswordField(EarthProperty.PLANET_MAPS_KEY);
        planetApiKeyField.setEnabled(openPlanetCheckbox.isSelected());
        registerComponent(EarthProperty.PLANET_MAPS_KEY, planetApiKeyField);

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

        // Planet Maps
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(3)
                .build();
        add(openPlanetCheckbox, constraints);

        // Planet API Key
        constraints = new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(4)
                .build();
        add(new JLabel(Messages.getString("OptionWizard.101")), constraints);

        constraints = new GridBagConstraintsBuilder()
                .gridx(1)
                .gridy(4)
                .build();
        add(planetApiKeyField, constraints);

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

        // Planet checkbox toggles API key field
        openPlanetCheckbox.addActionListener(e ->
                planetApiKeyField.setEnabled(openPlanetCheckbox.isSelected()));

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

    // ========== Getters ==========

    public JCheckBox getOpenGeeAppCheckbox() {
        return openGeeAppCheckbox;
    }

    public JCheckBox getOpenEarthMapCheckbox() {
        return openEarthMapCheckbox;
    }

    public JCheckBox getOpenPlanetCheckbox() {
        return openPlanetCheckbox;
    }

    public JCheckBox getOpenSecureWatchCheckbox() {
        return openSecureWatchCheckbox;
    }
}
