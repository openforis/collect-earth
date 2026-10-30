package org.openforis.collect.earth.app.service.settings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.BUFFER_SHAPE;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;

/** The figures the Swing plot layout panel computed, now from the values alone. */
public class PlotGeometryTest {

	private static Map<String, String> values(String... keysAndValues) {
		Map<String, String> values = new HashMap<>();
		for (int i = 0; i < keysAndValues.length; i += 2) {
			values.put(keysAndValues[i], keysAndValues[i + 1]);
		}
		return values;
	}

	/** A square plot of 25 points 10 m apart with no margin: 40 m of side */
	private static Map<String, String> square25() {
		return values("sample_shape", "SQUARE", "number_of_sampling_points_in_plot", "25", "distance_between_sample_points", "10",
				"distance_to_plot_boundaries", "0", "buffer_shape", "SQUARE", "distance_to_buffers", "50");
	}

	@Test
	public void aSquarePlotIsItsGridOfPointsPlusTheMargin() {
		PlotGeometry plot = PlotGeometry.of(square25());
		assertEquals(20d, plot.plotHalfExtent(), 0.001);
		assertEquals(1600d, plot.plotArea(), 0.001);
		assertEquals(0.16, PlotGeometry.hectares(plot.plotArea()), 0.0001);
		assertEquals(10000d, plot.referenceArea(), 0.001);
		assertTrue(plot.isSquare());
		assertFalse(plot.isRound());
		assertTrue(plot.hasReferenceArea());
		// A square with one point or none is sized by its margin alone
		PlotGeometry single = PlotGeometry.of(values("sample_shape", "SQUARE", "number_of_sampling_points_in_plot", "1",
				"distance_between_sample_points", "10", "distance_to_plot_boundaries", "12"));
		assertEquals(12d, single.plotHalfExtent(), 0.001);
		// 2x2 points 10 m apart with a margin of 5: 20 m of side
		PlotGeometry four = PlotGeometry.of(values("sample_shape", "SQUARE_WITH_LARGE_CENTRAL_PLOT", "number_of_sampling_points_in_plot", "4",
				"distance_between_sample_points", "10", "distance_to_plot_boundaries", "5"));
		assertEquals(10d, four.plotHalfExtent(), 0.001);
	}

	@Test
	public void theReferenceAreaMustEncloseThePlot() {
		Map<String, String> values = square25();
		assertEquals(21, PlotGeometry.of(values).minimumReferenceDistance());
		values.put("buffer_shape", "CIRCLE");
		assertEquals(30, PlotGeometry.of(values).minimumReferenceDistance());
		values.put("buffer_shape", "HEXAGON");
		assertEquals(33, PlotGeometry.of(values).minimumReferenceDistance());
	}

	@Test
	public void theRecommendedDistanceGivesTenTimesThePlot() {
		Map<String, String> values = square25();
		assertEquals(64, PlotGeometry.of(values).recommendedReferenceDistance());
		values.put("buffer_shape", "CIRCLE");
		assertEquals(72, PlotGeometry.of(values).recommendedReferenceDistance());
		// Never under the minimum, never over the range: a plot of 2000 m of side wants 3163, enclosed at 1001
		values.put("buffer_shape", "SQUARE");
		values.put("distance_between_sample_points", "500");
		assertEquals(1001, PlotGeometry.of(values).minimumReferenceDistance());
		assertEquals(3163, PlotGeometry.of(values).recommendedReferenceDistance());
		values.put("number_of_sampling_points_in_plot", "100");
		values.put("distance_between_sample_points", "1000");
		assertEquals(PlotGeometry.MAX_REFERENCE_DISTANCE, PlotGeometry.of(values).recommendedReferenceDistance());
	}

	@Test
	public void aSmallReferenceAreaIsNoticed() {
		Map<String, String> values = square25();
		assertTrue(PlotGeometry.of(values).isReferenceAreaSmall());
		values.put("distance_to_buffers", "64");
		assertFalse(PlotGeometry.of(values).isReferenceAreaSmall());
	}

	@Test
	public void aRoundPlotIsItsRadiusAndIsDrawnWithAMargin() {
		PlotGeometry circle = PlotGeometry.of(values("sample_shape", "CIRCLE", "number_of_sampling_points_in_plot", "4",
				"distance_between_sample_points", "15", "buffer_shape", "SQUARE", "distance_to_buffers", "50"));
		assertTrue(circle.isRound());
		assertEquals(15d, circle.plotHalfExtent(), 0.001);
		assertEquals(20d, circle.plotOutlineHalfExtent(), 0.001);
		assertEquals(Math.PI * 225, circle.plotArea(), 0.001);
		assertEquals(21, circle.minimumReferenceDistance());
		// A circular reference area only has to reach the outline of a round plot
		PlotGeometry hexagon = PlotGeometry.of(values("sample_shape", "HEXAGON", "distance_between_sample_points", "15",
				"buffer_shape", "CIRCLE", "distance_to_buffers", "50"));
		assertEquals(3 * Math.sqrt(3) / 2 * 225, hexagon.plotArea(), 0.001);
		assertEquals(21, hexagon.minimumReferenceDistance());
		assertEquals(Math.PI * 2500, hexagon.referenceArea(), 0.001);
	}

	@Test
	public void theOtherShapesHaveNoAreaNorReferenceArea() {
		PlotGeometry polygon = PlotGeometry.of(values("sample_shape", "KML_POLYGON", "buffer_shape", "SQUARE", "distance_to_buffers", "50"));
		assertFalse(polygon.hasArea());
		assertFalse(polygon.hasReferenceArea());
		PlotGeometry nfi = PlotGeometry.of(values("sample_shape", "NFI_THREE_CIRCLES"));
		assertFalse(nfi.hasArea());
		// Nor a square plot without a shape for it
		PlotGeometry none = PlotGeometry.of(values("sample_shape", "SQUARE", "buffer_shape", "NONE", "distance_to_buffers", "50"));
		assertFalse(none.hasReferenceArea());
	}

	@Test
	public void valuesAreReadAsTheSwingSpinnersReadThem() {
		assertEquals(10, PlotGeometry.parseIntWithinRange("", 10, 2, 1000));
		assertEquals(10, PlotGeometry.parseIntWithinRange("ten", 10, 2, 1000));
		assertEquals(2, PlotGeometry.parseIntWithinRange("-5", 10, 2, 1000));
		assertEquals(1000, PlotGeometry.parseIntWithinRange("5000", 10, 2, 1000));
		assertEquals(42, PlotGeometry.parseIntWithinRange(" 42 ", 10, 2, 1000));
		// Only the first of several comma separated reference distances
		assertEquals(30, PlotGeometry.of(values("distance_to_buffers", "30,60")).getReferenceDistance());
		assertEquals(PlotGeometry.DEFAULT_REFERENCE_DISTANCE, PlotGeometry.of(values()).getReferenceDistance());
		// An unknown number of points is none, as the combo box of the dialog showed it
		assertEquals(0, PlotGeometry.of(values("number_of_sampling_points_in_plot", "x")).getPoints());
	}

	@Test
	public void theShapesAreReadAsLocalPropertiesServiceReadsThem() {
		assertEquals(SAMPLE_SHAPE.SQUARE, PlotGeometry.shapeOf(values()));
		assertEquals(SAMPLE_SHAPE.SQUARE, PlotGeometry.shapeOf(values("sample_shape", "TRIANGLE")));
		assertEquals(SAMPLE_SHAPE.HEXAGON, PlotGeometry.shapeOf(values("sample_shape", " hexagon ")));
		// Projects older than the setting: no shape stored means none without a distance, and square with one
		assertEquals(BUFFER_SHAPE.NONE, PlotGeometry.bufferShapeOf(values()));
		assertEquals(BUFFER_SHAPE.SQUARE, PlotGeometry.bufferShapeOf(values("distance_to_buffers", "50")));
		assertEquals(BUFFER_SHAPE.SQUARE, PlotGeometry.bufferShapeOf(values("buffer_shape", "OVAL")));
		assertEquals(BUFFER_SHAPE.HEXAGON, PlotGeometry.bufferShapeOf(values("buffer_shape", "hexagon")));
	}
}
