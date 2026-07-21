package org.openforis.collect.earth.app.service;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;

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
}
