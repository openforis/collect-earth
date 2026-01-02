package org.openforis.collect.earth.app.view.properties;

import java.awt.GridBagConstraints;
import java.awt.Insets;

/**
 * Builder class for creating GridBagConstraints with a fluent API.
 * Reduces boilerplate code when setting up GridBagLayout-based panels.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class GridBagConstraintsBuilder {

    private int gridx = 0;
    private int gridy = 0;
    private int gridwidth = 1;
    private int gridheight = 1;
    private double weightx = 0.0;
    private double weighty = 0.0;
    private int anchor = GridBagConstraints.NORTHWEST;
    private int fill = GridBagConstraints.HORIZONTAL;
    private Insets insets = new Insets(8, 8, 8, 8);
    private int ipadx = 0;
    private int ipady = 0;

    /**
     * Creates a new builder with default settings for property panels.
     */
    public GridBagConstraintsBuilder() {
        // Default values set in field declarations
    }

    /**
     * Creates default constraints suitable for most property panel layouts.
     */
    public static GridBagConstraints createDefault() {
        return new GridBagConstraintsBuilder()
                .weightx(1.0)
                .build();
    }

    /**
     * Creates constraints for form labels (left-aligned, no expansion).
     */
    public static GridBagConstraints createLabel(int gridx, int gridy) {
        return new GridBagConstraintsBuilder()
                .gridx(gridx)
                .gridy(gridy)
                .weightx(0.0)
                .fill(GridBagConstraints.NONE)
                .anchor(GridBagConstraints.LINE_START)
                .build();
    }

    /**
     * Creates constraints for form fields (expandable horizontally).
     */
    public static GridBagConstraints createField(int gridx, int gridy) {
        return new GridBagConstraintsBuilder()
                .gridx(gridx)
                .gridy(gridy)
                .weightx(1.0)
                .fill(GridBagConstraints.HORIZONTAL)
                .build();
    }

    /**
     * Creates constraints for full-width components.
     */
    public static GridBagConstraints createFullWidth(int gridy) {
        return new GridBagConstraintsBuilder()
                .gridx(0)
                .gridy(gridy)
                .gridwidth(GridBagConstraints.REMAINDER)
                .weightx(1.0)
                .fill(GridBagConstraints.HORIZONTAL)
                .build();
    }

    /**
     * Creates constraints for components that should fill both dimensions.
     */
    public static GridBagConstraints createFillBoth(int gridx, int gridy) {
        return new GridBagConstraintsBuilder()
                .gridx(gridx)
                .gridy(gridy)
                .weightx(1.0)
                .weighty(1.0)
                .fill(GridBagConstraints.BOTH)
                .build();
    }

    public GridBagConstraintsBuilder gridx(int gridx) {
        this.gridx = gridx;
        return this;
    }

    public GridBagConstraintsBuilder gridy(int gridy) {
        this.gridy = gridy;
        return this;
    }

    public GridBagConstraintsBuilder gridwidth(int gridwidth) {
        this.gridwidth = gridwidth;
        return this;
    }

    public GridBagConstraintsBuilder gridheight(int gridheight) {
        this.gridheight = gridheight;
        return this;
    }

    public GridBagConstraintsBuilder weightx(double weightx) {
        this.weightx = weightx;
        return this;
    }

    public GridBagConstraintsBuilder weighty(double weighty) {
        this.weighty = weighty;
        return this;
    }

    public GridBagConstraintsBuilder anchor(int anchor) {
        this.anchor = anchor;
        return this;
    }

    public GridBagConstraintsBuilder fill(int fill) {
        this.fill = fill;
        return this;
    }

    public GridBagConstraintsBuilder insets(Insets insets) {
        this.insets = insets;
        return this;
    }

    public GridBagConstraintsBuilder insets(int top, int left, int bottom, int right) {
        this.insets = new Insets(top, left, bottom, right);
        return this;
    }

    public GridBagConstraintsBuilder ipadx(int ipadx) {
        this.ipadx = ipadx;
        return this;
    }

    public GridBagConstraintsBuilder ipady(int ipady) {
        this.ipady = ipady;
        return this;
    }

    /**
     * Move to the next row (increment gridy).
     */
    public GridBagConstraintsBuilder nextRow() {
        this.gridy++;
        this.gridx = 0;
        return this;
    }

    /**
     * Move to the next column (increment gridx).
     */
    public GridBagConstraintsBuilder nextColumn() {
        this.gridx++;
        return this;
    }

    /**
     * Builds and returns the configured GridBagConstraints.
     */
    public GridBagConstraints build() {
        GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridx = gridx;
        constraints.gridy = gridy;
        constraints.gridwidth = gridwidth;
        constraints.gridheight = gridheight;
        constraints.weightx = weightx;
        constraints.weighty = weighty;
        constraints.anchor = anchor;
        constraints.fill = fill;
        constraints.insets = insets;
        constraints.ipadx = ipadx;
        constraints.ipady = ipady;
        return constraints;
    }

    /**
     * Builds constraints and returns a new builder for the next row.
     * Useful for chaining row additions.
     */
    public GridBagConstraints buildAndNextRow() {
        GridBagConstraints result = build();
        nextRow();
        return result;
    }
}
