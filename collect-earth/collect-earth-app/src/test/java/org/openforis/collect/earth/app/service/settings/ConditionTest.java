package org.openforis.collect.earth.app.service.settings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.openforis.collect.earth.app.service.settings.Condition.all;
import static org.openforis.collect.earth.app.service.settings.Condition.any;
import static org.openforis.collect.earth.app.service.settings.Condition.atLeast;
import static org.openforis.collect.earth.app.service.settings.Condition.in;
import static org.openforis.collect.earth.app.service.settings.Condition.not;
import static org.openforis.collect.earth.app.service.settings.Condition.notBlank;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.openforis.collect.earth.app.EarthConstants.SAMPLE_SHAPE;
import org.openforis.collect.earth.app.service.LocalPropertiesService.EarthProperty;

/** When a setting is shown: the same conditions the page evaluates (settings.test.ts has the same cases). */
public class ConditionTest {

	private static Map<String, String> values(String... keysAndValues) {
		Map<String, String> values = new HashMap<>();
		for (int i = 0; i < keysAndValues.length; i += 2) {
			values.put(keysAndValues[i], keysAndValues[i + 1]);
		}
		return values;
	}

	@Test
	public void inHoldsForOneOfTheValues() {
		Condition shape = in(EarthProperty.SAMPLE_SHAPE, SAMPLE_SHAPE.SQUARE, SAMPLE_SHAPE.CIRCLE);
		assertTrue(shape.holds(values("sample_shape", "SQUARE")));
		assertTrue(shape.holds(values("sample_shape", "CIRCLE")));
		assertFalse(shape.holds(values("sample_shape", "HEXAGON")));
		assertFalse(shape.holds(values("sample_shape", "")));
		assertFalse(shape.holds(Collections.emptyMap()));
		assertTrue(in(EarthProperty.DB_DRIVER, "SQLITE", "CLOUD").holds(values("db_driver", "CLOUD")));
	}

	@Test
	public void atLeastHoldsForAWholeNumberOfAtLeastTheMinimum() {
		Condition points = atLeast(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, 2);
		assertTrue(points.holds(values("number_of_sampling_points_in_plot", "4")));
		assertTrue(points.holds(values("number_of_sampling_points_in_plot", " 2 ")));
		assertFalse(points.holds(values("number_of_sampling_points_in_plot", "1")));
		assertFalse(points.holds(values("number_of_sampling_points_in_plot", "")));
		assertFalse(points.holds(values("number_of_sampling_points_in_plot", "x")));
		assertFalse(points.holds(Collections.emptyMap()));
	}

	@Test
	public void notBlankHoldsForAValueWithSomethingInIt() {
		Condition key = notBlank(EarthProperty.PLANET_MAPS_KEY);
		assertTrue(key.holds(values("planet_maps_key", "abc")));
		assertFalse(key.holds(values("planet_maps_key", " ")));
		assertFalse(key.holds(Collections.emptyMap()));
	}

	@Test
	public void allAnyAndNotCombineThem() {
		Condition square = in(EarthProperty.SAMPLE_SHAPE, SAMPLE_SHAPE.SQUARE);
		Condition manyPoints = atLeast(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, 2);
		assertTrue(all(square, manyPoints).holds(values("sample_shape", "SQUARE", "number_of_sampling_points_in_plot", "4")));
		assertFalse(all(square, manyPoints).holds(values("sample_shape", "SQUARE", "number_of_sampling_points_in_plot", "1")));
		assertTrue(any(square, manyPoints).holds(values("sample_shape", "CIRCLE", "number_of_sampling_points_in_plot", "4")));
		assertFalse(any(square, manyPoints).holds(values("sample_shape", "CIRCLE", "number_of_sampling_points_in_plot", "1")));
		assertTrue(not(square).holds(values("sample_shape", "CIRCLE")));
		assertFalse(not(square).holds(values("sample_shape", "SQUARE")));
		// With nothing to check, all holds and any does not
		assertTrue(all().holds(Collections.emptyMap()));
		assertFalse(any().holds(Collections.emptyMap()));
	}

	@Test
	public void isSentToThePageAsJson() {
		assertEquals(json("key", "sample_shape", "in", Arrays.asList("SQUARE", "CIRCLE")),
				in(EarthProperty.SAMPLE_SHAPE, SAMPLE_SHAPE.SQUARE, SAMPLE_SHAPE.CIRCLE).toJson());
		assertEquals(json("key", "number_of_sampling_points_in_plot", "min", 2),
				atLeast(EarthProperty.NUMBER_OF_SAMPLING_POINTS_IN_PLOT, 2).toJson());
		assertEquals(json("key", "planet_maps_key", "notBlank", true), notBlank(EarthProperty.PLANET_MAPS_KEY).toJson());
		Condition square = in(EarthProperty.SAMPLE_SHAPE, SAMPLE_SHAPE.SQUARE);
		Condition key = notBlank(EarthProperty.PLANET_MAPS_KEY);
		assertEquals(json("all", Arrays.asList(square.toJson(), key.toJson())), all(square, key).toJson());
		assertEquals(json("any", Arrays.asList(square.toJson(), key.toJson())), any(square, key).toJson());
		assertEquals(json("not", square.toJson()), not(square).toJson());
	}

	private static Map<String, Object> json(Object... keysAndValues) {
		Map<String, Object> json = new HashMap<>();
		for (int i = 0; i < keysAndValues.length; i += 2) {
			json.put((String) keysAndValues[i], keysAndValues[i + 1]);
		}
		return json;
	}
}
