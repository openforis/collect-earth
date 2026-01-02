package org.openforis.collect.earth.app.view.properties;

import java.awt.Component;
import java.awt.Container;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.util.HashMap;

import javax.swing.BorderFactory;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.border.BevelBorder;
import javax.swing.border.Border;
import javax.swing.border.TitledBorder;

import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Abstract base class for property dialog panels.
 * Provides common functionality for panel creation and component management.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public abstract class AbstractPropertyPanel extends JPanel {

    private static final long serialVersionUID = 1L;

    protected final transient Logger logger = LoggerFactory.getLogger(getClass());
    protected final transient LocalPropertiesService localPropertiesService;
    protected final transient PropertyComponentFactory componentFactory;
    protected final HashMap<Enum<?>, JComponent[]> propertyToComponent;
    protected final HashMap<JComponent, JLabel> componentToRowLabel;

    private int currentRow = 0;

    /**
     * Creates a new property panel.
     *
     * @param localPropertiesService The properties service for reading/writing values
     * @param propertyToComponent    Shared map for property-to-component bindings
     * @param componentToRowLabel    Shared map for component-to-label bindings
     */
    protected AbstractPropertyPanel(LocalPropertiesService localPropertiesService,
                                    HashMap<Enum<?>, JComponent[]> propertyToComponent,
                                    HashMap<JComponent, JLabel> componentToRowLabel) {
        this.localPropertiesService = localPropertiesService;
        this.componentFactory = new PropertyComponentFactory(localPropertiesService);
        this.propertyToComponent = propertyToComponent != null ? propertyToComponent : new HashMap<>();
        this.componentToRowLabel = componentToRowLabel != null ? componentToRowLabel : new HashMap<>();

        setLayout(new GridBagLayout());
        setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
    }

    /**
     * Creates a new property panel with its own component maps.
     */
    protected AbstractPropertyPanel(LocalPropertiesService localPropertiesService) {
        this(localPropertiesService, new HashMap<>(), new HashMap<>());
    }

    /**
     * Initialize and build the panel content.
     * Subclasses must implement this to add their components.
     */
    protected abstract void buildPanel();

    /**
     * Gets the property-to-component mapping for this panel.
     */
    public HashMap<Enum<?>, JComponent[]> getPropertyToComponent() {
        return propertyToComponent;
    }

    /**
     * Gets the component-to-label mapping for this panel.
     */
    public HashMap<JComponent, JLabel> getComponentToRowLabel() {
        return componentToRowLabel;
    }

    // ========== Layout Helpers ==========

    /**
     * Adds a component spanning the full width at the current row.
     */
    protected void addFullWidthComponent(JComponent component) {
        GridBagConstraints constraints = GridBagConstraintsBuilder.createFullWidth(currentRow++);
        add(component, constraints);
    }

    /**
     * Adds a labeled component as a form row.
     */
    protected void addLabeledComponent(String labelText, JComponent component) {
        GridBagConstraints labelConstraints = GridBagConstraintsBuilder.createLabel(0, currentRow);
        JLabel label = new JLabel(labelText);
        add(label, labelConstraints);

        GridBagConstraints fieldConstraints = GridBagConstraintsBuilder.createField(1, currentRow);
        add(component, fieldConstraints);

        componentToRowLabel.put(component, label);
        currentRow++;
    }

    /**
     * Adds a labeled component with a specific width.
     */
    protected void addLabeledComponent(String labelText, JComponent component, int gridWidth) {
        GridBagConstraints labelConstraints = GridBagConstraintsBuilder.createLabel(0, currentRow);
        JLabel label = new JLabel(labelText);
        add(label, labelConstraints);

        GridBagConstraints fieldConstraints = new GridBagConstraintsBuilder()
                .gridx(1)
                .gridy(currentRow)
                .gridwidth(gridWidth)
                .weightx(1.0)
                .build();
        add(component, fieldConstraints);

        componentToRowLabel.put(component, label);
        currentRow++;
    }

    /**
     * Adds a component at a specific position.
     */
    protected void addComponent(JComponent component, int gridx, int gridy) {
        GridBagConstraints constraints = new GridBagConstraintsBuilder()
                .gridx(gridx)
                .gridy(gridy)
                .build();
        add(component, constraints);
    }

    /**
     * Adds a component with custom constraints.
     */
    protected void addComponent(JComponent component, GridBagConstraints constraints) {
        add(component, constraints);
    }

    /**
     * Increments the current row counter.
     */
    protected void nextRow() {
        currentRow++;
    }

    /**
     * Gets the current row number.
     */
    protected int getCurrentRow() {
        return currentRow;
    }

    /**
     * Sets the current row number.
     */
    protected void setCurrentRow(int row) {
        this.currentRow = row;
    }

    // ========== Component Registration ==========

    /**
     * Registers a component with a property.
     */
    protected void registerComponent(EarthProperty property, JComponent... components) {
        propertyToComponent.put(property, components);
    }

    /**
     * Registers a component with its label for visibility toggling.
     */
    protected void registerComponentLabel(JComponent component, JLabel label) {
        componentToRowLabel.put(component, label);
    }

    // ========== Border Helpers ==========

    /**
     * Creates a titled border with bevel effect.
     */
    protected Border createTitledBorder(String title) {
        return new TitledBorder(new BevelBorder(BevelBorder.LOWERED), title);
    }

    /**
     * Creates a raised titled border.
     */
    protected Border createRaisedTitledBorder(String title) {
        return new TitledBorder(new BevelBorder(BevelBorder.RAISED), title);
    }

    // ========== Container Helpers ==========

    /**
     * Enables or disables all components in a container recursively.
     */
    protected void enableContainer(Container container, boolean enable) {
        Component[] components = container.getComponents();
        for (Component component : components) {
            component.setEnabled(enable);
            if (component instanceof Container) {
                enableContainer((Container) component, enable);
            }
        }
    }

    /**
     * Sets visibility and enabled state for a component and its label.
     */
    protected void setRowState(JComponent component, boolean enabledAndVisible) {
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

    // ========== Validation ==========

    /**
     * Validates all components in this panel.
     * @return true if all validations pass
     */
    public boolean validateFields() {
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
}
