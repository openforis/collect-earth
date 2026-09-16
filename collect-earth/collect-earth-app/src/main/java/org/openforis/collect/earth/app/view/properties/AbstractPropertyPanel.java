package org.openforis.collect.earth.app.view.properties;

import java.awt.Component;
import java.awt.Container;
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
import org.openforis.collect.earth.app.view.Messages;
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
     * Adds a "label : component" row to a container laid out with GridBagLayout and registers the label, so that
     * {@link #setRowState(JComponent, boolean)} hides and shows both together.
     *
     * @param labelKey key of the label text in the Messages bundle
     * @return the label, for the rare case where its text changes later
     */
    protected JLabel addLabeledRow(Container target, int row, String labelKey, JComponent component) {
        JLabel label = new JLabel(Messages.getString(labelKey));
        target.add(label, GridBagConstraintsBuilder.createLabel(0, row));
        target.add(component, GridBagConstraintsBuilder.createField(1, row));
        componentToRowLabel.put(component, label);
        return label;
    }

    /**
     * Adds a component spanning all the columns of a container laid out with GridBagLayout.
     */
    protected void addFullWidthRow(Container target, int row, JComponent component) {
        target.add(component, GridBagConstraintsBuilder.createFullWidth(row));
    }

    // ========== Component Registration ==========

    /**
     * Registers a component with a property.
     */
    protected void registerComponent(EarthProperty property, JComponent... components) {
        propertyToComponent.put(property, components);
    }

    // ========== Border Helpers ==========

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
