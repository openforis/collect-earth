package org.openforis.collect.earth.app.view.properties;

import java.awt.Color;
import java.awt.Dimension;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;

import javax.swing.InputVerifier;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JPasswordField;
import javax.swing.JRadioButton;
import javax.swing.JSpinner;
import javax.swing.JTextField;
import javax.swing.SpinnerNumberModel;
import javax.swing.UIManager;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

import org.apache.commons.lang3.StringUtils;
import org.jdesktop.swingx.JXDatePicker;
import org.jdesktop.swingx.plaf.basic.CalendarHeaderHandler;
import org.jdesktop.swingx.plaf.basic.SpinningCalendarHeaderHandler;
import org.jdesktop.swingx.prompt.PromptSupport;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.ComboBoxItem;
import org.openforis.collect.earth.app.view.JFilePicker;
import org.openforis.collect.earth.app.view.JFilePicker.DlgMode;
import org.openforis.collect.earth.app.view.Messages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Factory class for creating property dialog UI components.
 * Centralizes component creation with consistent styling and behavior.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class PropertyComponentFactory {

    private static final Logger logger = LoggerFactory.getLogger(PropertyComponentFactory.class);
    private static final String START_OF_LANDSAT_AND_MODIS = "2000-01-01";
    private static final Dimension TEXT_FIELD_MIN_SIZE = new Dimension(250, 20);

    private final LocalPropertiesService localPropertiesService;

    public PropertyComponentFactory(LocalPropertiesService localPropertiesService) {
        this.localPropertiesService = localPropertiesService;
    }

    // ========== Checkbox Components ==========

    /**
     * Creates a checkbox for a boolean property.
     */
    public JCheckBox createCheckbox(String labelKey, EarthProperty property) {
        JCheckBox checkbox = new JCheckBox(Messages.getString(labelKey));
        checkbox.setSelected(Boolean.parseBoolean(localPropertiesService.getValue(property)));
        return checkbox;
    }

    /**
     * Creates a checkbox with a custom initial value.
     */
    public JCheckBox createCheckbox(String labelKey, boolean selected) {
        JCheckBox checkbox = new JCheckBox(Messages.getString(labelKey));
        checkbox.setSelected(selected);
        return checkbox;
    }

    // ========== Text Field Components ==========

    /**
     * Creates a standard text field for a property.
     */
    public JTextField createTextField(EarthProperty property) {
        JTextField textField = new JTextField(localPropertiesService.getValue(property));
        textField.setMinimumSize(TEXT_FIELD_MIN_SIZE);
        return textField;
    }

    /**
     * Creates a text field with a tooltip.
     */
    public JTextField createTextField(EarthProperty property, String tooltip) {
        JTextField textField = createTextField(property);
        textField.setToolTipText(tooltip);
        return textField;
    }

    /**
     * Creates a text field with validation.
     */
    public JTextField createValidatedTextField(EarthProperty property, InputVerifier validator, String tooltip) {
        JTextField textField = createTextField(property);
        textField.setToolTipText(tooltip);
        textField.setInputVerifier(validator);
        addRealTimeValidation(textField, validator);
        return textField;
    }

    /**
     * Creates a text field with placeholder text.
     */
    public JTextField createTextFieldWithPlaceholder(EarthProperty property, String placeholder, String tooltip) {
        JTextField textField = createTextField(property);
        textField.setToolTipText(tooltip);
        PromptSupport.setPrompt(placeholder, textField);
        return textField;
    }

    /**
     * Creates a password field for a property.
     */
    public JPasswordField createPasswordField(EarthProperty property) {
        JPasswordField passwordField = new JPasswordField(localPropertiesService.getValue(property));
        passwordField.setMinimumSize(TEXT_FIELD_MIN_SIZE);
        return passwordField;
    }

    /**
     * Creates a disabled text field (for display-only values).
     */
    public JTextField createDisabledTextField(EarthProperty property) {
        JTextField textField = createTextField(property);
        textField.setEnabled(false);
        return textField;
    }

    // ========== Spinner Components ==========

    /**
     * Creates a spinner for integer values with range validation.
     */
    public JSpinner createIntegerSpinner(EarthProperty property, int defaultValue, int min, int max, String tooltip) {
        int value = parseIntWithinRange(localPropertiesService.getValue(property), defaultValue, min, max);
        JSpinner spinner = new JSpinner(new SpinnerNumberModel(value, min, max, 1));
        spinner.setToolTipText(tooltip);
        return spinner;
    }

    /**
     * Creates a spinner with custom step size.
     */
    public JSpinner createIntegerSpinner(EarthProperty property, int defaultValue, int min, int max, int step, String tooltip) {
        int value = parseIntWithinRange(localPropertiesService.getValue(property), defaultValue, min, max);
        JSpinner spinner = new JSpinner(new SpinnerNumberModel(value, min, max, step));
        spinner.setToolTipText(tooltip);
        return spinner;
    }

    // ========== ComboBox Components ==========

    /**
     * Creates a combo box for sample shapes.
     */
    public JComboBox<SAMPLE_SHAPE> createSampleShapeComboBox(EarthProperty property) {
        JComboBox<SAMPLE_SHAPE> comboBox = new JComboBox<>(SAMPLE_SHAPE.values());
        try {
            comboBox.setSelectedItem(SAMPLE_SHAPE.valueOf(localPropertiesService.getValue(property)));
        } catch (Exception e) {
            logger.warn("Invalid sample shape value: {}", localPropertiesService.getValue(property));
        }
        return comboBox;
    }

    /**
     * Creates the number of sampling points combo box.
     */
    public JComboBox<ComboBoxItem> createSamplingPointsComboBox(EarthProperty property) {
        ComboBoxItem[] items = {
                new ComboBoxItem(0, Messages.getString("OptionWizard.53")),  // Square
                new ComboBoxItem(1, Messages.getString("OptionWizard.54")),  // Central point
                new ComboBoxItem(4, "2x2"),
                new ComboBoxItem(9, "3x3"),
                new ComboBoxItem(16, "4x4"),
                new ComboBoxItem(25, "5x5"),
                new ComboBoxItem(36, "6x6"),
                new ComboBoxItem(49, "7x7")
        };

        JComboBox<ComboBoxItem> comboBox = new JComboBox<>(items);

        String value = localPropertiesService.getValue(property);
        if (StringUtils.isNotBlank(value)) {
            try {
                int numPoints = Integer.parseInt(value);
                comboBox.setSelectedItem(new ComboBoxItem(numPoints, ""));
            } catch (NumberFormatException e) {
                logger.warn("Invalid number of sampling points: {}", value);
            }
        }

        return comboBox;
    }

    // ========== Radio Button Components ==========

    /**
     * Creates a radio button with a name identifier.
     */
    public JRadioButton createRadioButton(String label, String name, boolean selected) {
        JRadioButton radioButton = new JRadioButton(label);
        radioButton.setName(name);
        radioButton.setSelected(selected);
        return radioButton;
    }

    // ========== Date Picker Components ==========

    /**
     * Creates a date picker for a property.
     */
    public JXDatePicker createDatePicker(EarthProperty property, String tooltip) {
        // Enable year selection in JXDatePicker
        UIManager.put(CalendarHeaderHandler.uiControllerID, SpinningCalendarHeaderHandler.class.getName());

        SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd");

        JXDatePicker datePicker = new JXDatePicker();
        datePicker.getMonthView().setZoomable(true);
        datePicker.setFormats(dateFormat);
        datePicker.setToolTipText(tooltip);
        datePicker.setMinimumSize(TEXT_FIELD_MIN_SIZE);

        try {
            datePicker.getMonthView().setLowerBound(dateFormat.parse(START_OF_LANDSAT_AND_MODIS));
            datePicker.getMonthView().setUpperBound(new Date());

            String value = localPropertiesService.getValue(property);
            if (StringUtils.isNotBlank(value)) {
                datePicker.setDate(dateFormat.parse(value));
            }
        } catch (ParseException e) {
            logger.error("Error parsing date for property {}", property, e);
        }

        return datePicker;
    }

    // ========== File Picker Components ==========

    /**
     * Creates a file picker for selecting files.
     */
    public JFilePicker createFilePicker(String labelKey, EarthProperty property, String buttonLabelKey, DlgMode mode) {
        return new JFilePicker(
                Messages.getString(labelKey),
                localPropertiesService.getValue(property),
                Messages.getString(buttonLabelKey),
                mode
        );
    }

    /**
     * Creates a file picker with file type filter.
     */
    public JFilePicker createFilePicker(String labelKey, EarthProperty property, String buttonLabelKey,
                                        DlgMode mode, String extensions, String filterDescription) {
        JFilePicker filePicker = createFilePicker(labelKey, property, buttonLabelKey, mode);
        filePicker.addFileTypeFilter(extensions, Messages.getString(filterDescription), true);
        return filePicker;
    }

    /**
     * Creates a folder picker.
     */
    public JFilePicker createFolderPicker(String labelKey, EarthProperty property, String buttonLabelKey) {
        JFilePicker filePicker = new JFilePicker(
                Messages.getString(labelKey),
                localPropertiesService.getValue(property),
                Messages.getString(buttonLabelKey),
                DlgMode.MODE_OPEN
        );
        filePicker.setFolderChooser();
        return filePicker;
    }

    // ========== Utility Methods ==========

    /**
     * Adds real-time validation to a text field.
     */
    public void addRealTimeValidation(JTextField textField, InputVerifier validator) {
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
                } else {
                    textField.setBackground(PropertyValidators.ERROR_COLOR);
                }
            }
        });
    }

    /**
     * Parses an integer value with range clamping.
     */
    public static int parseIntWithinRange(String value, int defaultValue, int min, int max) {
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
            logger.warn("Value {} is below minimum {}. Clamping to {}", parsedValue, min, min);
            return min;
        }
        if (parsedValue > max) {
            logger.warn("Value {} is above maximum {}. Clamping to {}", parsedValue, max, max);
            return max;
        }
        return parsedValue;
    }

    /**
     * Registers a component with the property mapping.
     */
    public static void registerComponent(java.util.Map<Enum<?>, JComponent[]> propertyToComponent,
                                         EarthProperty property, JComponent... components) {
        propertyToComponent.put(property, components);
    }
}
