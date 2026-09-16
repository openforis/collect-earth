package org.openforis.collect.earth.app.view.properties;

import java.awt.Color;
import java.text.DecimalFormat;
import java.text.MessageFormat;
import java.util.HashMap;

import javax.swing.InputVerifier;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JSpinner;
import javax.swing.JTextField;
import javax.swing.SpinnerNumberModel;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.BUFFER_SHAPE;
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

    /** Below this ratio between the frame area and the plot area the frame shows too little of the surroundings. */
    private static final double MIN_FRAME_TO_PLOT_AREA_RATIO = 10d;
    /** Margin that CircleKmlGenerator adds to the radius when drawing the outline of circle and hexagon plots. */
    private static final double CIRCLE_PLOT_MARGIN = 5d;
    private static final int MIN_FRAME_DISTANCE = 1;
    private static final int MAX_FRAME_DISTANCE = 10000;
    private static final int DEFAULT_FRAME_DISTANCE = 100;
    private static final double COS_30 = Math.cos(Math.toRadians(30));
    /** Area of a regular hexagon = factor * (distance from the center to a vertex)^2 */
    private static final double HEXAGON_AREA_FACTOR = 3 * Math.sqrt(3) / 2;
    private static final double SQUARE_METERS_PER_HECTARE = 10000d;
    private static final Color WARNING_TEXT_COLOR = new Color(180, 90, 0);
    private static final DecimalFormat HECTARES_FORMAT = new DecimalFormat("###.##");

    // UI Components
    private JComboBox<SAMPLE_SHAPE> plotShape;
    private JComboBox<ComboBoxItem> numberPoints;
    private JSpinner distanceBetweenPoints;
    private JSpinner distanceToFrame;
    private JSpinner dotsSide;
    private JSpinner largeCentralPlotSide;
    private JSpinner distanceBetweenPlots;
    private JComboBox<BUFFER_SHAPE> frameShape;
    private JSpinner frameDistance;
    private JLabel frameWarningLabel;
    private JLabel areaLabel;
    /** The same field is the distance between points of a square plot and the radius of a round one. */
    private JLabel distanceOrRadiusLabel;

    // State
    /** True until the user types a frame distance, when none was stored in the properties: the panel proposes one. */
    private boolean frameDistanceNeverSet;
    /** Guards the change listener of the spinner against the values set by the panel itself. */
    private boolean settingFrameDistance;

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
                Messages.getString("OptionWizard.1027"));
        registerComponent(EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS, distanceBetweenPoints);

        distanceToFrame = componentFactory.createIntegerSpinner(
                EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, 0, 0, 500,
                Messages.getString("OptionWizard.1028"));
        registerComponent(EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES, distanceToFrame);

        dotsSide = componentFactory.createIntegerSpinner(
                EarthProperty.INNER_SUBPLOT_SIDE, 2, 2, 100,
                Messages.getString("OptionWizard.1029"));
        registerComponent(EarthProperty.INNER_SUBPLOT_SIDE, dotsSide);

        largeCentralPlotSide = componentFactory.createIntegerSpinner(
                EarthProperty.LARGE_CENTRAL_PLOT_SIDE, 20, 2, 200,
                Messages.getString("OptionWizard.1030"));
        registerComponent(EarthProperty.LARGE_CENTRAL_PLOT_SIDE, largeCentralPlotSide);

        distanceBetweenPlots = componentFactory.createIntegerSpinner(
                EarthProperty.DISTANCE_BETWEEN_PLOTS, 100, 2, 1000,
                Messages.getString("OptionWizard.1031"));
        registerComponent(EarthProperty.DISTANCE_BETWEEN_PLOTS, distanceBetweenPlots);

        // Outer frame drawn around the plot to give an idea of the surroundings (not part of the plot itself)
        frameShape = componentFactory.createBufferShapeComboBox();
        registerComponent(EarthProperty.BUFFER_SHAPE, frameShape);

        frameDistanceNeverSet = StringUtils.isBlank(localPropertiesService.getValue(EarthProperty.DISTANCE_TO_BUFFERS));
        frameDistance = new JSpinner(new SpinnerNumberModel(getStoredFrameDistance(), MIN_FRAME_DISTANCE, MAX_FRAME_DISTANCE, 1));
        frameDistance.setToolTipText(Messages.getString("OptionWizard.1023"));
        frameDistance.setInputVerifier(new FrameDistanceVerifier());
        registerComponent(EarthProperty.DISTANCE_TO_BUFFERS, frameDistance);

        frameWarningLabel = new JLabel("<html><body style='width: 380px'>" + Messages.getString("OptionWizard.1024") + "</body></html>");
        frameWarningLabel.setForeground(WARNING_TEXT_COLOR);

        // Area display label, filled by updateAreaLabel()
        areaLabel = new JLabel();
    }

    /**
     * distance_to_buffers may hold several comma separated distances when it was edited by hand in earth.properties;
     * the panel edits (and saves back) only the first one.
     */
    private int getStoredFrameDistance() {
        String stored = localPropertiesService.getValue(EarthProperty.DISTANCE_TO_BUFFERS);
        String first = StringUtils.substringBefore(stored, ",").trim();
        return PropertyComponentFactory.parseIntWithinRange(first, DEFAULT_FRAME_DISTANCE, MIN_FRAME_DISTANCE, MAX_FRAME_DISTANCE);
    }

    private void layoutComponents() {
        int row = 0;
        addLabeledRow(this, row++, "OptionWizard.128", plotShape);
        addLabeledRow(this, row++, "OptionWizard.35", numberPoints);
        distanceOrRadiusLabel = addLabeledRow(this, row++, "OptionWizard.36", distanceBetweenPoints);
        addLabeledRow(this, row++, "OptionWizard.37", distanceToFrame);
        addLabeledRow(this, row++, "OptionWizard.95", dotsSide);
        addLabeledRow(this, row++, "OptionWizard.129", largeCentralPlotSide);
        addLabeledRow(this, row++, "OptionWizard.130", distanceBetweenPlots);
        addLabeledRow(this, row++, "OptionWizard.1022", frameShape);
        addLabeledRow(this, row++, "OptionWizard.1023", frameDistance);
        addFullWidthRow(this, row++, frameWarningLabel);
        addFullWidthRow(this, row, areaLabel);
    }

    private void setupListeners() {
        plotShape.addActionListener(e -> handleVisibilityPlotLayout());
        numberPoints.addActionListener(e -> {
            syncRowsWithNumberOfPoints();
            refreshDerivedInfo();
        });
        // The plot geometry moves the area and the thresholds of the frame checks
        distanceBetweenPoints.addChangeListener(e -> refreshDerivedInfo());
        distanceToFrame.addChangeListener(e -> refreshDerivedInfo());

        frameShape.addActionListener(e -> {
            handleFrameVisibility();
            proposeFrameDistanceIfNeeded();
            refreshDerivedInfo();
        });
        frameDistance.addChangeListener(e -> {
            if (!settingFrameDistance) {
                frameDistanceNeverSet = false;
            }
            refreshDerivedInfo();
        });
    }

    /**
     * Handles visibility of plot layout components based on selected shape.
     */
    private void handleVisibilityPlotLayout() {
        // First, disable all components
        setRowState(numberPoints, false);
        setRowState(distanceBetweenPoints, false);
        setRowState(distanceToFrame, false);
        setRowState(dotsSide, false);
        setRowState(distanceBetweenPlots, false);
        setRowState(largeCentralPlotSide, false);
        setRowState(frameShape, false);
        areaLabel.setVisible(false);

        // Then enable specific components based on the selected shape
        SAMPLE_SHAPE selectedShape = selectedPlotShape();

        if (isSquarePlot()) {
            setRowState(numberPoints, true);
            setRowState(distanceToFrame, true);
            setRowState(frameShape, true);
            areaLabel.setVisible(true);
            distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.36"));

            if (selectedShape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT) {
                setRowState(largeCentralPlotSide, true);
            }
        } else if (isRoundPlot()) {
            setRowState(numberPoints, true);
            setRowState(frameShape, true);
            areaLabel.setVisible(true);
            distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.132"));
        } else if (selectedShape == SAMPLE_SHAPE.NFI_THREE_CIRCLES || selectedShape == SAMPLE_SHAPE.NFI_FOUR_CIRCLES) {
            setRowState(dotsSide, true);
            setRowState(distanceBetweenPoints, true);
            setRowState(distanceBetweenPlots, true);
            distanceOrRadiusLabel.setText(Messages.getString("OptionWizard.133"));
        }

        syncRowsWithNumberOfPoints();
        handleFrameVisibility();
        refreshDerivedInfo();

        revalidate();
        repaint();
    }

    /**
     * Rows whose meaning depends on the number of sample points, an option only square and round plots have.
     * Hidden rows are saved as empty properties; KmlGeneratorService reads those as 0.
     */
    private void syncRowsWithNumberOfPoints() {
        boolean roundPlot = isRoundPlot();
        if (!isSquarePlot() && !roundPlot) {
            return;
        }
        int points = numberOfPoints();
        // A square plot with one point or none is sized by its margin alone; for round plots the field is the radius
        setRowState(distanceBetweenPoints, roundPlot || points > 1);
        // Without sample points there are no dots to size
        setRowState(dotsSide, points >= 1);
    }

    /**
     * The frame distance only makes sense when a frame shape is selected for a plot shape that supports frames.
     * Hidden rows are saved as empty properties, so "no frame" ends up as an empty distance_to_buffers.
     */
    private void handleFrameVisibility() {
        boolean frameOn = frameShape.isVisible() && selectedFrameShape() != BUFFER_SHAPE.NONE;
        setRowState(frameDistance, frameOn);
    }

    /**
     * Until the user sets a distance, turning the frame on (or changing its shape) proposes the distance that gives
     * enough context; a distance that would not enclose the plot is replaced by that same proposal.
     */
    private void proposeFrameDistanceIfNeeded() {
        if (frameDistance.isVisible()
                && (frameDistanceNeverSet || (Integer) frameDistance.getValue() < minimumFrameDistance())) {
            setFrameDistance(recommendedFrameDistance());
        }
    }

    private void setFrameDistance(int distance) {
        settingFrameDistance = true;
        try {
            frameDistance.setValue(distance);
        } finally {
            settingFrameDistance = false;
        }
    }

    private void refreshDerivedInfo() {
        updateAreaLabel();
        updateFrameWarning();
    }

    private void updateAreaLabel() {
        String text = Messages.getString("OptionWizard.131") + formatHectares(plotArea());
        if (frameDistance.isVisible()) {
            text += "      " + Messages.getString("OptionWizard.1026")
                    + formatHectares(frameArea((Integer) frameDistance.getValue()));
        }
        areaLabel.setText(text);
    }

    private static String formatHectares(double squareMeters) {
        return HECTARES_FORMAT.format(squareMeters / SQUARE_METERS_PER_HECTARE);
    }

    private void updateFrameWarning() {
        boolean frameOn = frameDistance.isVisible();
        boolean tooSmall = frameOn
                && frameArea((Integer) frameDistance.getValue()) < MIN_FRAME_TO_PLOT_AREA_RATIO * plotArea();
        frameWarningLabel.setVisible(tooSmall);
        if (frameOn) {
            // Re-run the verifier so the field colour follows changes of the plot geometry, not only of the spinner
            frameDistance.getInputVerifier().verify(frameDistance);
        }
        revalidate();
        repaint();
    }

    // ========== Plot and frame geometry ==========

    private SAMPLE_SHAPE selectedPlotShape() {
        return (SAMPLE_SHAPE) plotShape.getSelectedItem();
    }

    private BUFFER_SHAPE selectedFrameShape() {
        return (BUFFER_SHAPE) frameShape.getSelectedItem();
    }

    private boolean isSquarePlot() {
        SAMPLE_SHAPE selectedShape = selectedPlotShape();
        return selectedShape == SAMPLE_SHAPE.SQUARE || selectedShape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT;
    }

    private boolean isRoundPlot() {
        SAMPLE_SHAPE selectedShape = selectedPlotShape();
        return selectedShape == SAMPLE_SHAPE.CIRCLE || selectedShape == SAMPLE_SHAPE.HEXAGON;
    }

    private int numberOfPoints() {
        return ((ComboBoxItem) numberPoints.getSelectedItem()).getNumberOfPoints();
    }

    /**
     * Half of the side of a square plot (the side is the sample point grid plus the margin on both ends, as laid out
     * by SquareKmlGenerator), or the radius of a round plot, in meters.
     */
    private double plotHalfExtent() {
        int distanceBetweenPointsI = (Integer) distanceBetweenPoints.getValue();
        if (isRoundPlot()) {
            return distanceBetweenPointsI;
        }
        int points = numberOfPoints();
        int margin = (Integer) distanceToFrame.getValue();
        double side = points <= 1
                ? 2d * margin
                : 2d * margin + (Math.sqrt(points) - 1) * distanceBetweenPointsI;
        return side / 2d;
    }

    /**
     * Half extent of the outline actually drawn in Google Earth: round plots are drawn CIRCLE_PLOT_MARGIN meters
     * beyond their radius.
     */
    private double plotOutlineHalfExtent() {
        return isRoundPlot() ? plotHalfExtent() + CIRCLE_PLOT_MARGIN : plotHalfExtent();
    }

    private double plotArea() {
        double halfExtent = plotHalfExtent();
        SAMPLE_SHAPE selectedShape = selectedPlotShape();
        if (selectedShape == SAMPLE_SHAPE.CIRCLE) {
            return Math.PI * halfExtent * halfExtent;
        } else if (selectedShape == SAMPLE_SHAPE.HEXAGON) {
            return HEXAGON_AREA_FACTOR * halfExtent * halfExtent;
        }
        return 4 * halfExtent * halfExtent;
    }

    /**
     * Area enclosed by a frame at the given distance from the plot center. The distance means what
     * AbstractPolygonKmlGenerator draws: half side of a square frame, radius of a circle frame and distance from the
     * center to a vertex of a hexagon frame.
     */
    private double frameArea(double distance) {
        switch (selectedFrameShape()) {
        case CIRCLE:
            return Math.PI * distance * distance;
        case HEXAGON:
            return HEXAGON_AREA_FACTOR * distance * distance;
        default:
            return 4 * distance * distance;
        }
    }

    /**
     * Smallest frame distance at which the frame still encloses the whole plot outline, so that the frame is always
     * larger than the plot.
     */
    private int minimumFrameDistance() {
        double halfExtent = plotOutlineHalfExtent();
        boolean roundPlot = isRoundPlot();
        double minimum;
        switch (selectedFrameShape()) {
        case CIRCLE:
            // The circle has to reach the corners of a square plot
            minimum = roundPlot ? halfExtent : halfExtent * Math.sqrt(2);
            break;
        case HEXAGON:
            // The flat sides of the hexagon lie at distance * cos(30) from the center. The corner (h, h) of a square
            // plot leans against a slanted side, at h * (cos(30) + sin(30)) from the center
            minimum = roundPlot ? halfExtent / COS_30 : halfExtent * (COS_30 + 0.5) / COS_30;
            break;
        default:
            minimum = halfExtent;
        }
        return Math.max(MIN_FRAME_DISTANCE, (int) Math.ceil(minimum) + 1);
    }

    /**
     * Frame distance at which the frame area is {@link #MIN_FRAME_TO_PLOT_AREA_RATIO} times the plot area.
     */
    private int recommendedFrameDistance() {
        double targetArea = MIN_FRAME_TO_PLOT_AREA_RATIO * plotArea();
        double distance;
        switch (selectedFrameShape()) {
        case CIRCLE:
            distance = Math.sqrt(targetArea / Math.PI);
            break;
        case HEXAGON:
            distance = Math.sqrt(targetArea / HEXAGON_AREA_FACTOR);
            break;
        default:
            distance = Math.sqrt(targetArea) / 2d;
        }
        return Math.min(MAX_FRAME_DISTANCE, Math.max((int) Math.ceil(distance), minimumFrameDistance()));
    }

    /**
     * Blocks applying the options while the frame would not enclose the plot.
     */
    private class FrameDistanceVerifier extends InputVerifier {
        @Override
        public boolean verify(JComponent input) {
            int minimum = minimumFrameDistance();
            boolean valid = (Integer) frameDistance.getValue() >= minimum;
            JTextField editor = ((JSpinner.DefaultEditor) frameDistance.getEditor()).getTextField();
            editor.setBackground(valid ? PropertyValidators.VALID_COLOR : PropertyValidators.ERROR_COLOR);
            frameDistance.setToolTipText(valid
                    ? Messages.getString("OptionWizard.1023")
                    : MessageFormat.format(Messages.getString("OptionWizard.1025"), minimum));
            return valid;
        }
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

    public JComboBox<BUFFER_SHAPE> getFrameShape() {
        return frameShape;
    }

    public JSpinner getFrameDistance() {
        return frameDistance;
    }
}
