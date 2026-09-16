package org.openforis.collect.earth.app.view.properties;

import java.awt.GridBagLayout;
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
import org.openforis.collect.earth.app.view.PlanetMonthlyObject;

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
    private JComboBox<PlanetMonthlyObject> planetTfoFromMonth;
    private JComboBox<PlanetMonthlyObject> planetTfoToMonth;
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
                Messages.getString("OptionWizard.1038"));
        registerComponent(EarthProperty.GEEAPP_FROM_DATE, geeAppFromDate);

        geeAppToDate = componentFactory.createDatePicker(EarthProperty.GEEAPP_TO_DATE,
                Messages.getString("OptionWizard.1039"));
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

        planetTfoFromMonth = createTfoMonthComboBox(PlanetMonthlyObject.STARTING_DATE, availableMonths,
                localPropertiesService.getPlanetTfoDateFrom(), Messages.getString("OptionWizard.1040"));
        registerComponent(EarthProperty.PLANET_TFO_DATE_FROM, planetTfoFromMonth);

        planetTfoToMonth = createTfoMonthComboBox(PlanetMonthlyObject.PRESENT_DATE, availableMonths,
                localPropertiesService.getPlanetTfoDateTo(), Messages.getString("OptionWizard.1041"));
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
                Messages.getString("OptionWizard.1042")
        );
        extraUrlField.setInputVerifier(PropertyValidators.urlPlaceholderVerifier());
        registerComponent(EarthProperty.EXTRA_MAP_URL, extraUrlField);

        // Initialize visibility based on saved properties
        initializeVisibility();
    }

    /**
     * Month selector whose first entry is the localized "first / latest available" sentinel, saved as an empty
     * value. Older versions saved the English words "Oldest" / "Latest" instead: they match no month, so they
     * select the sentinel as well.
     */
    private JComboBox<PlanetMonthlyObject> createTfoMonthComboBox(PlanetMonthlyObject sentinel, String[] months,
            String savedValue, String tooltip) {
        JComboBox<PlanetMonthlyObject> comboBox = new JComboBox<>();
        comboBox.addItem(sentinel);
        for (String month : months) {
            PlanetMonthlyObject item = new PlanetMonthlyObject(month, month);
            comboBox.addItem(item);
            if (month.equals(savedValue)) {
                comboBox.setSelectedItem(item);
            }
        }
        comboBox.setToolTipText(tooltip);
        comboBox.setEnabled(openPlanetCheckbox.isSelected() && useTfoCheckbox.isSelected());
        return comboBox;
    }

    private void initializeVisibility() {
        boolean hasFromDate = StringUtils.isNotBlank(localPropertiesService.getValue(EarthProperty.GEEAPP_FROM_DATE));
        specifyStartAndEndGeeApp.setSelected(hasFromDate);
        geeAppDatePanel.setVisible(hasFromDate && openGeeAppCheckbox.isSelected());
        specifyStartAndEndGeeApp.setVisible(openGeeAppCheckbox.isSelected());
    }

    private void layoutComponents() {
        // GEE App checkbox with the date range checkbox next to it
        add(openGeeAppCheckbox, GridBagConstraintsBuilder.createDefault());
        add(specifyStartAndEndGeeApp, new GridBagConstraintsBuilder().gridx(1).gridy(0).build());
        addFullWidthRow(this, 1, geeAppDatePanel);

        addFullWidthRow(this, 2, openEarthMapCheckbox);
        addFullWidthRow(this, 3, openEsriWaybackCheckbox);

        // Planet Maps panel (contains all Planet-related components)
        addFullWidthRow(this, 4, planetPanel);

        // Maxar SecureWatch
        addFullWidthRow(this, 5, openSecureWatchCheckbox);
        addLabeledRow(this, 6, "OptionWizard.1021", secureWatchUrlField);

        // Extra Map URL
        JLabel extraLabel = new JLabel(Messages.getString("OptionWizard.103"));
        extraLabel.setToolTipText(Messages.getString("OptionWizard.1042"));
        addFullWidthRow(this, 7, extraLabel);
        addFullWidthRow(this, 8, extraUrlField);
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
     * Generates an array of date options for the TFO date selectors.
     * Includes:
     * - Static biannual mosaics (Dec 2015 - Aug 2020)
     * - Monthly mosaics (September 2020 to previous month)
     */
    private String[] generateTfoMonthOptions() {
        List<String> dates = new ArrayList<>();

        // Static biannual mosaics (these are the only bimonthly images available)
        dates.add("2015-12_2016-05");
        dates.add("2016-06_2016-11");
        dates.add("2016-12_2017-05");
        dates.add("2017-06_2017-11");
        dates.add("2017-12_2018-05");
        dates.add("2018-06_2018-11");
        dates.add("2018-12_2019-05");
        dates.add("2019-06_2019-11");
        dates.add("2019-12_2020-05");
        dates.add("2020-06_2020-08");

        // Monthly mosaics start from September 2020
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

        // Generate monthly mosaics from September 2020 to previous month
        int year = startYear;
        int month = startMonth;

        while (year < endYear || (year == endYear && month <= endMonth)) {
            // Format as YYYY-MM
            String monthStr = String.format("%d-%02d", year, month);
            dates.add(monthStr);

            // Move to next month
            month++;
            if (month > 12) {
                month = 1;
                year++;
            }
        }

        return dates.toArray(new String[0]);
    }

    /**
     * Creates a bordered panel containing all Planet-related components.
     */
    private JPanel createPlanetPanel() {
        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createTitledBorder(
                BorderFactory.createEtchedBorder(),
                "Planet NICFI"));

        addFullWidthRow(panel, 0, openPlanetCheckbox);
        addLabeledRow(panel, 1, "OptionWizard.101", planetApiKeyField);
        addFullWidthRow(panel, 2, useTfoCheckbox);
        addFullWidthRow(panel, 3, planetTfoMonthPanel);

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
