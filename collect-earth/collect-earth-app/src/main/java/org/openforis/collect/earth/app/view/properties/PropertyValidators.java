package org.openforis.collect.earth.app.view.properties;

import java.awt.Color;
import java.net.MalformedURLException;
import java.net.URL;

import javax.swing.InputVerifier;
import javax.swing.JComponent;
import javax.swing.JOptionPane;
import javax.swing.JTextField;

/**
 * Collection of input validators for property dialog fields.
 * Provides reusable validation logic with visual feedback.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public final class PropertyValidators {

    // Color constants for validation feedback
    public static final Color ERROR_COLOR = new Color(255, 220, 220);
    public static final Color WARNING_COLOR = new Color(255, 250, 200);
    public static final Color VALID_COLOR = Color.WHITE;

    private PropertyValidators() {
        // Utility class - prevent instantiation
    }

    /**
     * Creates a validator for URL fields with placeholder support.
     * Validates URL format and checks for recommended placeholders.
     */
    public static InputVerifier urlPlaceholderVerifier() {
        return new UrlPlaceholderVerifier();
    }

    /**
     * Creates a validator for port number fields.
     * Accepts values between 1 and 65535.
     */
    public static InputVerifier portValidator() {
        return new PortValidator();
    }

    /**
     * Creates a validator for non-empty required fields.
     */
    public static InputVerifier requiredFieldValidator() {
        return new RequiredFieldValidator();
    }

    /**
     * Creates a validator for integer fields within a range.
     */
    public static InputVerifier integerRangeValidator(int min, int max) {
        return new IntegerRangeValidator(min, max);
    }

    /**
     * Creates a validator for database connection fields.
     */
    public static InputVerifier databaseConnectionValidator() {
        return new RequiredFieldValidator();
    }

    /**
     * Creates a general URL validator.
     */
    public static InputVerifier urlValidator() {
        return new UrlValidator();
    }

    // ========== Validator Implementations ==========

    /**
     * Validates URLs with placeholder support for map services.
     */
    public static class UrlPlaceholderVerifier extends InputVerifier {
        @Override
        public boolean verify(JComponent input) {
            String text = ((JTextField) input).getText().trim();
            if (text.isEmpty()) {
                resetValidation(input);
                return true;
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
            } else if ((hasLatitude && !hasLongitude) || (!hasLatitude && hasLongitude)) {
                showWarning(input, "You should set both LATITUDE and LONGITUDE.");
                return true; // Allow saving with warning
            }

            resetValidation(input);
            return true;
        }

        private void showError(JComponent input, String message) {
            input.setBackground(ERROR_COLOR);
            input.setToolTipText(message);

            JOptionPane.showMessageDialog(
                    input.getParent(),
                    message + "\n\nPlease ensure your URL follows this format:\nhttps://example.com/map?lat=LATITUDE&lon=LONGITUDE",
                    "Invalid Map URL",
                    JOptionPane.ERROR_MESSAGE);
            input.requestFocusInWindow();
        }

        private void showWarning(JComponent input, String message) {
            input.setBackground(WARNING_COLOR);
            input.setToolTipText(message);

            String detailedMessage = message +
                    "\n\nRecommended placeholders:" +
                    "\n  - LATITUDE, LONGITUDE - for coordinate-based maps" +
                    "\n  - PLOT_ID - for plot identifier-based maps" +
                    "\n  - GEOJSON - for geometry-based maps" +
                    "\n\nExample: https://maps.example.com?lat=LATITUDE&lon=LONGITUDE&plot=PLOT_ID";

            JOptionPane.showMessageDialog(
                    input.getParent(),
                    detailedMessage,
                    "Map URL Configuration",
                    JOptionPane.WARNING_MESSAGE);
        }
    }

    /**
     * Validates port numbers (1-65535).
     */
    public static class PortValidator extends InputVerifier {
        @Override
        public boolean verify(JComponent input) {
            String text = ((JTextField) input).getText().trim();
            if (text.isEmpty()) {
                resetValidation(input);
                return true;
            }

            try {
                int port = Integer.parseInt(text);
                if (port > 0 && port <= 65535) {
                    resetValidation(input);
                    return true;
                }
            } catch (NumberFormatException e) {
                // Fall through to error handling
            }

            input.setBackground(ERROR_COLOR);
            input.setToolTipText("Port must be a number between 1 and 65535");
            return false;
        }
    }

    /**
     * Validates that a field is not empty.
     */
    public static class RequiredFieldValidator extends InputVerifier {
        @Override
        public boolean verify(JComponent input) {
            String text = ((JTextField) input).getText().trim();
            if (text.isEmpty()) {
                input.setBackground(ERROR_COLOR);
                input.setToolTipText("This field is required");
                return false;
            }
            resetValidation(input);
            return true;
        }
    }

    /**
     * Validates integer values within a specified range.
     */
    public static class IntegerRangeValidator extends InputVerifier {
        private final int min;
        private final int max;

        public IntegerRangeValidator(int min, int max) {
            this.min = min;
            this.max = max;
        }

        @Override
        public boolean verify(JComponent input) {
            String text = ((JTextField) input).getText().trim();
            if (text.isEmpty()) {
                resetValidation(input);
                return true;
            }

            try {
                int value = Integer.parseInt(text);
                if (value >= min && value <= max) {
                    resetValidation(input);
                    return true;
                }
            } catch (NumberFormatException e) {
                // Fall through to error handling
            }

            input.setBackground(ERROR_COLOR);
            input.setToolTipText("Value must be between " + min + " and " + max);
            return false;
        }
    }

    /**
     * Validates general URL format.
     */
    public static class UrlValidator extends InputVerifier {
        @Override
        public boolean verify(JComponent input) {
            String text = ((JTextField) input).getText().trim();
            if (text.isEmpty()) {
                resetValidation(input);
                return true;
            }

            try {
                java.net.URI uri = java.net.URI.create(text);
                if (uri.getScheme() != null &&
                        (uri.getScheme().equals("http") || uri.getScheme().equals("https")) &&
                        uri.getHost() != null) {
                    resetValidation(input);
                    return true;
                }
            } catch (Exception e) {
                // Fall through to error handling
            }

            input.setBackground(ERROR_COLOR);
            input.setToolTipText("Invalid URL format. Must start with http:// or https://");
            return false;
        }
    }

    /**
     * Resets the validation state of a component.
     */
    public static void resetValidation(JComponent input) {
        input.setBackground(VALID_COLOR);
        input.setToolTipText(null);
    }

    /**
     * Sets error state on a component.
     */
    public static void setError(JComponent input, String message) {
        input.setBackground(ERROR_COLOR);
        input.setToolTipText(message);
    }

    /**
     * Sets warning state on a component.
     */
    public static void setWarning(JComponent input, String message) {
        input.setBackground(WARNING_COLOR);
        input.setToolTipText(message);
    }
}
