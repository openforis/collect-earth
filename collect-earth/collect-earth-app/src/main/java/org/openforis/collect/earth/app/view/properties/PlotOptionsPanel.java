package org.openforis.collect.earth.app.view.properties;

import java.awt.GridBagConstraints;
import java.awt.Insets;
import java.text.DecimalFormat;
import java.util.HashMap;

import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JSpinner;

import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.service.LocalPropertiesService;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;
import org.openforis.collect.earth.app.view.ComboBoxItem;
import org.openforis.collect.earth.app.view.Messages;

/**
 * Panel for configuring plot shape and sampling point options.
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public class PlotOptionsPanel extends AbstractPropertyPanel {

    private static final long serialVersionUID = 1L;

    // UI Components
    private JComboBox<SAMPLE_SHAPE> plotShape;
    private JComboBox<ComboBoxItem> numberPoints;
    private JSpinner distanceBetweenPoints;
    private JSpinner distanceToFrame;
    private JSpinner dotsSide;
    private JSpinner largeCentralPlotSide;
    private JSpinner distanceBetweenPlots;
    private JLabel areaLabel;

    // Labels for visibility control
    private JLabel numberPointsLabel;
    private JLabel distanceOrRadiusLabel;
    private JLabel distanceToFrameLabel;
    private JLabel dotsSideLabel;
    private JLabel largeCentralPlotSideLabel;
    private JLabel plotDistanceInClusterLabel;

    // State
    private String oldSelectedDistance;

    /**
     * Creates a new plot options panel.
     */
    public PlotOptionsPanel(LocalPropertiesService localPropertiesService,
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
        // Initialize visibility based on current selection
        handleVisibilityPlotLayout();
    }

    private void initializeComponents() {
        // Plot shape dropdown
        plotShape = componentFactory.createSampleShapeComboBox(EarthProperty.SAMPLE_SHAPE);
        registerComponent(EarthProperty.SAMPLE_SHAPE, plotShape);

        // Number of points dropdown
        numberPoints = componentFactory.createSamplingPointsComboBox(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT);
        registerComponent(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, numberPoints);

        // Distance spinners
        distanceBetweenPoints = componentFactory.createIntegerSpinner(
                EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS, 10, 2, 1000,
                "Distance between sampling points in meters (2-1000)");
        registerComponent(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS, distanceBetweenPoints);

        distanceToFrame = componentFactory.createIntegerSpinner(
                EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, 0, 0, 500,
                "Distance to plot boundaries in meters (0-500)");
        registerComponent(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, distanceToFrame);

        dotsSide = componentFactory.createIntegerSpinner(
                EarthProperty.INNER_SUBPLOT_SIDE, 2, 2, 100,
                "Size of inner subplot side in meters (2-100)");
        registerComponent(EarthProperty.INNER_SUBPLOT_SIDE, dotsSide);

        largeCentralPlotSide = componentFactory.createIntegerSpinner(
                EarthProperty.LARGE_CENTRAL_PLOT_SIDE, 20, 2, 200,
                "Size of large central plot side in meters (2-200)");
        registerComponent(EarthProperty.LARGE_CENTRAL_PLOT_SIDE, largeCentralPlotSide);

        distanceBetweenPlots = componentFactory.createIntegerSpinner(
                EarthProperty.DISTANCE_BETWEEN_PLOTS, 100, 2, 1000,
                "Distance between plots in cluster in meters (2-1000)");
        registerComponent(EarthProperty.DISTANCE_BETWEEN_PLOTS, distanceBetweenPlots);

        // Area display label
        areaLabel = new JLabel(Messages.getString("OptionWizard.131") + calculateArea());
    }

    private void layoutComponents() {
        GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridx = 0;
        constraints.gridy = 0;
        constraints.ipady = 5;
        constraints.ipadx = 5;
        constraints.anchor = GridBagConstraints.LINE_START;
        constraints.insets = new Insets(5, 5, 5, 15);
        constraints.fill = GridBagConstraints.HORIZONTAL;

        // Plot shape
        JLabel plotShapeLabel = new JLabel(Messages.getString("OptionWizard.128"));
        add(plotShapeLabel, constraints);
        constraints.gridx = 1;
        add(plotShape, constraints);

        // Number of points
        constraints.gridx = 0;
        constraints.gridy++;
        numberPointsLabel = new JLabel(Messages.getString("OptionWizard.35"));
        add(numberPointsLabel, constraints);
        constraints.gridx = 1;
        add(numberPoints, constraints);
        componentToRowLabel.put(numberPoints, numberPointsLabel);

        // Distance between points
        constraints.gridx = 0;
        constraints.gridy++;
        distanceOrRadiusLabel = new JLabel(Messages.getString("OptionWizard.36"));
        add(distanceOrRadiusLabel, constraints);
        constraints.gridx = 1;
        add(distanceBetweenPoints, constraints);
        componentToRowLabel.put(distanceBetweenPoints, distanceOrRadiusLabel);

        // Distance to frame
        constraints.gridx = 0;
        constraints.gridy++;
        distanceToFrameLabel = new JLabel(Messages.getString("OptionWizard.37"));
        add(distanceToFrameLabel, constraints);
        constraints.gridx = 1;
        add(distanceToFrame, constraints);
        componentToRowLabel.put(distanceToFrame, distanceToFrameLabel);

        // Dots side
        constraints.gridx = 0;
        constraints.gridy++;
        dotsSideLabel = new JLabel(Messages.getString("OptionWizard.95"));
        add(dotsSideLabel, constraints);
        constraints.gridx = 1;
        add(dotsSide, constraints);
        componentToRowLabel.put(dotsSide, dotsSideLabel);

        // Large central plot side
        constraints.gridx = 0;
        constraints.gridy++;
        largeCentralPlotSideLabel = new JLabel(Messages.getString("OptionWizard.129"));
        add(largeCentralPlotSideLabel, constraints);
        constraints.gridx = 1;
        add(largeCentralPlotSide, constraints);
        componentToRowLabel.put(largeCentralPlotSide, largeCentralPlotSideLabel);

        // Distance between plots in cluster
        constraints.gridx = 0;
        constraints.gridy++;
        plotDistanceInClusterLabel = new JLabel(Messages.getString("OptionWizard.130"));
        add(plotDistanceInClusterLabel, constraints);
        constraints.gridx = 1;
        add(distanceBetweenPlots, constraints);
        componentToRowLabel.put(distanceBetweenPlots, plotDistanceInClusterLabel);

        // Area display
        constraints.gridx = 0;
        constraints.gridy++;
        add(areaLabel, constraints);
    }

    private void setupListeners() {
        // Update area calculation when values change
        javax.swing.event.ChangeListener areaListener = e -> updateAreaLabel();

        plotShape.addActionListener(e -> {
            handleVisibilityPlotLayout();
            updateAreaLabel();
        });
        numberPoints.addActionListener(e -> updateAreaLabel());
        distanceBetweenPoints.addChangeListener(areaListener);
        distanceToFrame.addChangeListener(areaListener);
    }

    private void updateAreaLabel() {
        areaLabel.setText(Messages.getString("OptionWizard.131") + calculateArea());
    }

    /**
     * Handles visibility of plot layout components based on selected shape.
     */
    public void handleVisibilityPlotLayout() {
        // First, disable all components
        setRowState(numberPoints, false);
        setRowState(distanceBetweenPoints, false);
        setRowState(distanceToFrame, false);
        setRowState(dotsSide, false);
        setRowState(distanceBetweenPlots, false);
        setRowState(largeCentralPlotSide, false);
        areaLabel.setVisible(false);

        // Then enable specific components based on the selected shape
        SAMPLE_SHAPE selectedShape = (SAMPLE_SHAPE) plotShape.getSelectedItem();

        if (selectedShape == SAMPLE_SHAPE.SQUARE || selectedShape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT) {
            setRowState(numberPoints, true);
            setRowState(distanceBetweenPoints, true);
            setRowState(distanceToFrame, true);
            setRowState(dotsSide, true);
            areaLabel.setVisible(true);
            distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.36"));

            if (selectedShape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT) {
                setRowState(largeCentralPlotSide, true);
            }
        } else if (selectedShape == SAMPLE_SHAPE.CIRCLE || selectedShape == SAMPLE_SHAPE.HEXAGON) {
            setRowState(distanceBetweenPoints, true);
            setRowState(dotsSide, true);
            setRowState(numberPoints, true);
            distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.132"));
        } else if (selectedShape == SAMPLE_SHAPE.NFI_THREE_CIRCLES || selectedShape == SAMPLE_SHAPE.NFI_FOUR_CIRCLES) {
            setRowState(dotsSide, true);
            setRowState(distanceBetweenPoints, true);
            setRowState(distanceBetweenPlots, true);
            distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.133"));
        }

        revalidate();
        repaint();
    }

    /**
     * Calculates the area based on current plot parameters.
     */
    private String calculateArea() {
        double side = 0;
        try {
            int numberOfPointsI = ((ComboBoxItem) numberPoints.getSelectedItem()).getNumberOfPoints();
            int distanceBetweenPointsI = (Integer) distanceBetweenPoints.getValue();
            int distanceToFrameI = (Integer) distanceToFrame.getValue();

            SAMPLE_SHAPE selectedShape = (SAMPLE_SHAPE) plotShape.getSelectedItem();
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

    // ========== Getters for Components ==========

    public JComboBox<SAMPLE_SHAPE> getPlotShape() {
        return plotShape;
    }

    public JComboBox<ComboBoxItem> getNumberPoints() {
        return numberPoints;
    }

    public JSpinner getDistanceBetweenPoints() {
        return distanceBetweenPoints;
    }

    public JSpinner getDistanceToFrame() {
        return distanceToFrame;
    }

    public JSpinner getDotsSide() {
        return dotsSide;
    }

    public JSpinner getLargeCentralPlotSide() {
        return largeCentralPlotSide;
    }

    public JSpinner getDistanceBetweenPlots() {
        return distanceBetweenPlots;
    }
}
