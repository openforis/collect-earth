package org.openforis.collect.earth.app.service;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

public class PlotGeoJsonBuilderTest {

	private SimplePlacemarkObject squarePlot() {
		SimplePlacemarkObject p = new SimplePlacemarkObject();
		p.setPlacemarkId("plot_1");
		p.setCoord(new SimpleCoordinate("41.90", "12.45"));
		SimpleCoordinate a = new SimpleCoordinate("41.899", "12.449");
		SimpleCoordinate b = new SimpleCoordinate("41.899", "12.451");
		SimpleCoordinate c = new SimpleCoordinate("41.901", "12.451");
		SimpleCoordinate d = new SimpleCoordinate("41.901", "12.449");
		p.setMultiShape(Collections.singletonList(Arrays.asList(a, b, c, d, a)));
		return p;
	}

	/** A 4-vertex square sample (not pre-closed) around the given base coordinates. */
	private SimplePlacemarkObject sampleSquare(String lat, String lon) {
		SimplePlacemarkObject sample = new SimplePlacemarkObject();
		SimpleCoordinate a = new SimpleCoordinate(lat, lon);
		SimpleCoordinate b = new SimpleCoordinate(lat, addTiny(lon));
		SimpleCoordinate c = new SimpleCoordinate(addTiny(lat), addTiny(lon));
		SimpleCoordinate d = new SimpleCoordinate(addTiny(lat), lon);
		sample.setShape(Arrays.asList(a, b, c, d));
		return sample;
	}

	private String addTiny(String value) {
		return Double.toString(Double.parseDouble(value) + 0.001);
	}

	@Test
	public void buildsFeatureWithPolygonAndProperties() throws Exception {
		String json = new PlotGeoJsonBuilder().toFeature(squarePlot());
		JsonNode f = new ObjectMapper().readTree(json);
		assertEquals("Feature", f.get("type").asText());
		assertEquals("plot_1", f.get("properties").get("id").asText());
		assertEquals("41.90", f.get("properties").get("latitude").asText());
		JsonNode geom = f.get("geometry");
		assertEquals("GeometryCollection", geom.get("type").asText());
		JsonNode boundary = geom.get("geometries").get(0);
		assertEquals("Polygon", boundary.get("type").asText());
		// GeoJSON is [lon, lat]
		JsonNode first = boundary.get("coordinates").get(0).get(0);
		assertEquals(12.449, first.get(0).asDouble(), 1e-9);
		assertEquals(41.899, first.get(1).asDouble(), 1e-9);
		assertTrue(f.get("properties").has("elevation"));
	}

	@Test
	public void samplePointsBecomeAdditionalPolygons() throws Exception {
		SimplePlacemarkObject p = squarePlot();
		p.setPoints(Arrays.asList(sampleSquare("41.895", "12.440"), sampleSquare("41.905", "12.460")));
		String json = new PlotGeoJsonBuilder().toFeature(p);
		JsonNode geometries = new ObjectMapper().readTree(json).get("geometry").get("geometries");
		// boundary + two sample squares
		assertEquals(3, geometries.size());
		JsonNode secondGeom = geometries.get(1);
		assertEquals("Polygon", secondGeom.get("type").asText());
		JsonNode first = secondGeom.get("coordinates").get(0).get(0);
		// first sample square's first vertex, in [lon, lat] order
		assertEquals(12.440, first.get(0).asDouble(), 1e-9);
		assertEquals(41.895, first.get(1).asDouble(), 1e-9);
	}

	@Test
	public void csvColumnsMergedButCannotOverrideId() throws Exception {
		SimplePlacemarkObject p = squarePlot();
		Map<String, String> values = new LinkedHashMap<>();
		values.put("land_use", "forest");
		values.put("id", "EVIL");
		p.setValuesByColumn(values);
		JsonNode props = new ObjectMapper().readTree(new PlotGeoJsonBuilder().toFeature(p)).get("properties");
		assertEquals("forest", props.get("land_use").asText());
		// computed id must win over the CSV extra column
		assertEquals("plot_1", props.get("id").asText());
	}

	@Test
	public void openRingIsClosed() throws Exception {
		SimplePlacemarkObject p = new SimplePlacemarkObject();
		p.setPlacemarkId("plot_open");
		p.setCoord(new SimpleCoordinate("41.90", "12.45"));
		SimpleCoordinate a = new SimpleCoordinate("41.899", "12.449");
		SimpleCoordinate b = new SimpleCoordinate("41.899", "12.451");
		SimpleCoordinate c = new SimpleCoordinate("41.901", "12.451");
		SimpleCoordinate d = new SimpleCoordinate("41.901", "12.449");
		// ring NOT pre-closed (a, b, c, d only)
		p.setMultiShape(Collections.singletonList(Arrays.asList(a, b, c, d)));
		JsonNode coords = new ObjectMapper().readTree(new PlotGeoJsonBuilder().toFeature(p))
				.get("geometry").get("geometries").get(0).get("coordinates").get(0);
		assertEquals(5, coords.size());
		JsonNode ringFirst = coords.get(0);
		JsonNode ringLast = coords.get(4);
		assertEquals(ringFirst.get(0).asDouble(), ringLast.get(0).asDouble(), 1e-9);
		assertEquals(ringFirst.get(1).asDouble(), ringLast.get(1).asDouble(), 1e-9);
	}

	@Test
	public void degenerateRingIsSkipped() throws Exception {
		SimplePlacemarkObject p = new SimplePlacemarkObject();
		p.setPlacemarkId("plot_degen");
		p.setCoord(new SimpleCoordinate("41.90", "12.45"));
		SimpleCoordinate a = new SimpleCoordinate("41.899", "12.449");
		SimpleCoordinate b = new SimpleCoordinate("41.899", "12.451");
		SimpleCoordinate c = new SimpleCoordinate("41.901", "12.451");
		SimpleCoordinate d = new SimpleCoordinate("41.901", "12.449");
		SimpleCoordinate e = new SimpleCoordinate("41.902", "12.452");
		p.setMultiShape(Arrays.asList(
				Arrays.asList(a, b, c, d, a),
				Arrays.asList(e, a)));
		JsonNode geometries = new ObjectMapper().readTree(new PlotGeoJsonBuilder().toFeature(p))
				.get("geometry").get("geometries");
		// the 2-vertex ring is skipped, only the valid ring remains
		assertEquals(1, geometries.size());
	}

	@Test
	public void invalidCoordinateReportsPlotId() {
		SimplePlacemarkObject p = new SimplePlacemarkObject();
		p.setPlacemarkId("plot_bad");
		p.setCoord(new SimpleCoordinate("41.90", "12.45"));
		SimpleCoordinate a = new SimpleCoordinate("41.899", "12.449");
		SimpleCoordinate b = new SimpleCoordinate("41.899", "not-a-number");
		SimpleCoordinate c = new SimpleCoordinate("41.901", "12.451");
		p.setMultiShape(Collections.singletonList(Arrays.asList(a, b, c)));
		try {
			new PlotGeoJsonBuilder().toFeature(p);
			fail("Expected IllegalArgumentException for unparseable coordinate");
		} catch (IllegalArgumentException e) {
			assertTrue("message should contain plot id, was: " + e.getMessage(),
					e.getMessage().contains("plot_bad"));
		} catch (Exception e) {
			fail("Expected IllegalArgumentException but got " + e.getClass().getName());
		}
	}
}
