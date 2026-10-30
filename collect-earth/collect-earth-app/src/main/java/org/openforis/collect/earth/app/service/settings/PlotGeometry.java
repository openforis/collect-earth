package org.openforis.collect.earth.app.service.settings;

import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.app.EarthConstants.BUFFER_SHAPE;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

/**
 * The plot and its reference area as the plot settings describe them, in metres: what the Swing plot layout panel
 * computed to show the areas, to refuse a reference area smaller than the plot and to propose a distance. The rules
 * (SettingsValidator) and the figures the page shows come from here; the page draws the plot itself.
 * <p>
 * Values are read as the panel's spinners read them: blank or not a number is the default, out of range is clamped.
 */
public final class PlotGeometry {

	/** Below this ratio between the reference area and the plot area the reference area shows too little around the plot. */
	public static final double MIN_REFERENCE_AREA_TO_PLOT_AREA_RATIO = 10d;
	/** The margin CircleKmlGenerator adds to the radius when drawing the outline of circle and hexagon plots. */
	public static final double CIRCLE_PLOT_MARGIN = 5d;
	public static final int MIN_REFERENCE_DISTANCE = 1;
	public static final int MAX_REFERENCE_DISTANCE = 10000;
	public static final int DEFAULT_REFERENCE_DISTANCE = 100;
	public static final int MIN_DISTANCE_BETWEEN_POINTS = 2;
	public static final int MAX_DISTANCE_BETWEEN_POINTS = 1000;
	public static final int DEFAULT_DISTANCE_BETWEEN_POINTS = 10;
	public static final int MIN_MARGIN = 0;
	public static final int MAX_MARGIN = 500;
	public static final int DEFAULT_MARGIN = 0;
	public static final int MIN_INNER_SIDE = 2;
	public static final int MAX_INNER_SIDE = 100;
	public static final int DEFAULT_INNER_SIDE = 2;
	public static final int MIN_CENTRAL_PLOT_SIDE = 2;
	public static final int MAX_CENTRAL_PLOT_SIDE = 200;
	public static final int DEFAULT_CENTRAL_PLOT_SIDE = 20;
	public static final int MIN_DISTANCE_BETWEEN_PLOTS = 2;
	public static final int MAX_DISTANCE_BETWEEN_PLOTS = 1000;
	public static final int DEFAULT_DISTANCE_BETWEEN_PLOTS = 100;
	public static final double SQUARE_METERS_PER_HECTARE = 10000d;

	private static final double COS_30 = Math.cos(Math.toRadians(30));
	/** Area of a regular hexagon = factor * (distance from the centre to a vertex)^2 */
	private static final double HEXAGON_AREA_FACTOR = 3 * Math.sqrt(3) / 2;

	private final SAMPLE_SHAPE shape;
	private final BUFFER_SHAPE bufferShape;
	private final int points;
	/** The distance between the points of a square plot, the radius of a round one, the radius of the plots of an NFI cluster */
	private final int distanceBetweenPoints;
	private final int margin;
	private final int referenceDistance;

	private PlotGeometry(SAMPLE_SHAPE shape, BUFFER_SHAPE bufferShape, int points, int distanceBetweenPoints, int margin,
			int referenceDistance) {
		this.shape = shape;
		this.bufferShape = bufferShape;
		this.points = points;
		this.distanceBetweenPoints = distanceBetweenPoints;
		this.margin = margin;
		this.referenceDistance = referenceDistance;
	}

	/** From the values of the plot settings, by property name. */
	public static PlotGeometry of(Map<String, String> values) {
		String distanceToBuffers = Condition.valueOf(values, EarthProperty.DISTANCE_TO_BUFFERS.toString());
		return new PlotGeometry(shapeOf(values), bufferShapeOf(values),
				parseIntWithinRange(Condition.valueOf(values, EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT.toString()), 0, 0, 100),
				parseIntWithinRange(Condition.valueOf(values, EarthProperty.DISTANCE_BETWEEN_SAMPLE_POINTS.toString()),
						DEFAULT_DISTANCE_BETWEEN_POINTS, MIN_DISTANCE_BETWEEN_POINTS, MAX_DISTANCE_BETWEEN_POINTS),
				parseIntWithinRange(Condition.valueOf(values, EarthProperty.DISTANCE_TO_PLOT_BOUNDARIES.toString()), DEFAULT_MARGIN,
						MIN_MARGIN, MAX_MARGIN),
				// A file edited by hand may hold several comma separated distances: the settings edit the first one
				parseIntWithinRange(StringUtils.substringBefore(distanceToBuffers, ","), DEFAULT_REFERENCE_DISTANCE,
						MIN_REFERENCE_DISTANCE, MAX_REFERENCE_DISTANCE));
	}

	/** The shape stored, SQUARE when blank or unknown, as LocalPropertiesService.getSampleShape reads it. */
	public static SAMPLE_SHAPE shapeOf(Map<String, String> values) {
		String value = Condition.valueOf(values, EarthProperty.SAMPLE_SHAPE.toString()).trim().toUpperCase();
		try {
			return value.isEmpty() ? SAMPLE_SHAPE.SQUARE : SAMPLE_SHAPE.valueOf(value);
		} catch (IllegalArgumentException e) {
			return SAMPLE_SHAPE.SQUARE;
		}
	}

	/**
	 * The reference area shape stored. Blank is what the properties of projects older than the setting hold: NONE
	 * without a distance, else SQUARE, the shape those projects always had (LocalPropertiesService.getBufferShape).
	 * This is how the Swing panel showed them.
	 */
	public static BUFFER_SHAPE bufferShapeOf(Map<String, String> values) {
		String value = Condition.valueOf(values, EarthProperty.BUFFER_SHAPE.toString()).trim().toUpperCase();
		if (value.isEmpty()) {
			return StringUtils.isBlank(Condition.valueOf(values, EarthProperty.DISTANCE_TO_BUFFERS.toString())) ? BUFFER_SHAPE.NONE
					: BUFFER_SHAPE.SQUARE;
		}
		try {
			return BUFFER_SHAPE.valueOf(value);
		} catch (IllegalArgumentException e) {
			return BUFFER_SHAPE.SQUARE;
		}
	}

	/** As the spinners of the Swing dialog read a stored value: the default when it is not a number, clamped to the range. */
	public static int parseIntWithinRange(String value, int defaultValue, int min, int max) {
		int parsed = defaultValue;
		try {
			if (StringUtils.isNotBlank(value)) {
				parsed = Integer.parseInt(value.trim());
			}
		} catch (NumberFormatException e) {
			parsed = defaultValue;
		}
		return Math.max(min, Math.min(max, parsed));
	}

	public SAMPLE_SHAPE getShape() {
		return shape;
	}

	public BUFFER_SHAPE getBufferShape() {
		return bufferShape;
	}

	public int getPoints() {
		return points;
	}

	public int getReferenceDistance() {
		return referenceDistance;
	}

	public boolean isSquare() {
		return shape == SAMPLE_SHAPE.SQUARE || shape == SAMPLE_SHAPE.SQUARE_WITH_LARGE_CENTRAL_PLOT;
	}

	public boolean isRound() {
		return shape == SAMPLE_SHAPE.CIRCLE || shape == SAMPLE_SHAPE.HEXAGON;
	}

	/** Whether the plot settings describe a plot whose area is known: a square or round one. The others are files or clusters. */
	public boolean hasArea() {
		return isSquare() || isRound();
	}

	/** Whether a reference area is drawn: only square and round plots have one, and only when a shape is chosen for it. */
	public boolean hasReferenceArea() {
		return hasArea() && bufferShape != BUFFER_SHAPE.NONE;
	}

	/**
	 * Half of the side of a square plot (the grid of points plus the margin at both ends, as SquareKmlGenerator lays it
	 * out), or the radius of a round plot.
	 */
	public double plotHalfExtent() {
		if (isRound()) {
			return distanceBetweenPoints;
		}
		double side = points <= 1 ? 2d * margin : 2d * margin + (Math.sqrt(points) - 1) * distanceBetweenPoints;
		return side / 2d;
	}

	/** Half extent of the outline drawn: round plots are drawn CIRCLE_PLOT_MARGIN metres beyond their radius. */
	public double plotOutlineHalfExtent() {
		return isRound() ? plotHalfExtent() + CIRCLE_PLOT_MARGIN : plotHalfExtent();
	}

	/** In square metres. */
	public double plotArea() {
		double h = plotHalfExtent();
		if (shape == SAMPLE_SHAPE.CIRCLE) {
			return Math.PI * h * h;
		} else if (shape == SAMPLE_SHAPE.HEXAGON) {
			return HEXAGON_AREA_FACTOR * h * h;
		}
		return 4 * h * h;
	}

	/**
	 * The area enclosed by a reference area at this distance from the centre, in square metres. The distance means what
	 * AbstractPolygonKmlGenerator draws: half the side of a square one, the radius of a circular one, the distance from
	 * the centre to a vertex of a hexagonal one.
	 */
	public double referenceArea(double distance) {
		switch (bufferShape) {
		case CIRCLE:
			return Math.PI * distance * distance;
		case HEXAGON:
			return HEXAGON_AREA_FACTOR * distance * distance;
		default:
			return 4 * distance * distance;
		}
	}

	/** The area of the reference area at the distance stored, in square metres. */
	public double referenceArea() {
		return referenceArea(referenceDistance);
	}

	/** The smallest distance at which the reference area still encloses the whole outline of the plot. */
	public int minimumReferenceDistance() {
		double h = plotOutlineHalfExtent();
		boolean round = isRound();
		double minimum;
		switch (bufferShape) {
		case CIRCLE:
			// The circle has to reach the corners of a square plot
			minimum = round ? h : h * Math.sqrt(2);
			break;
		case HEXAGON:
			// The flat sides of the hexagon lie at distance * cos(30) from the centre. The corner (h, h) of a square plot
			// leans against a slanted side, at h * (cos(30) + sin(30)) from the centre
			minimum = round ? h / COS_30 : h * (COS_30 + 0.5) / COS_30;
			break;
		default:
			minimum = h;
		}
		return Math.max(MIN_REFERENCE_DISTANCE, (int) Math.ceil(minimum) + 1);
	}

	/** The distance at which the reference area is MIN_REFERENCE_AREA_TO_PLOT_AREA_RATIO times the plot, within the range. */
	public int recommendedReferenceDistance() {
		double targetArea = MIN_REFERENCE_AREA_TO_PLOT_AREA_RATIO * plotArea();
		double distance;
		switch (bufferShape) {
		case CIRCLE:
			distance = Math.sqrt(targetArea / Math.PI);
			break;
		case HEXAGON:
			distance = Math.sqrt(targetArea / HEXAGON_AREA_FACTOR);
			break;
		default:
			distance = Math.sqrt(targetArea) / 2d;
		}
		return Math.min(MAX_REFERENCE_DISTANCE, Math.max((int) Math.ceil(distance), minimumReferenceDistance()));
	}

	/** Whether the reference area at the distance stored is under MIN_REFERENCE_AREA_TO_PLOT_AREA_RATIO times the plot. */
	public boolean isReferenceAreaSmall() {
		return referenceArea() < MIN_REFERENCE_AREA_TO_PLOT_AREA_RATIO * plotArea();
	}

	public static double hectares(double squareMeters) {
		return squareMeters / SQUARE_METERS_PER_HECTARE;
	}
}
