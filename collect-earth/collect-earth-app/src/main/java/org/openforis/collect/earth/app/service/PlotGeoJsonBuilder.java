package org.openforis.collect.earth.app.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Serializes a plot (SimplePlacemarkObject) into a GeoJSON Feature consumed by
 * the Leaflet map page. Geometry is a GeometryCollection: first the plot
 * boundary/buffers (Polygons from multiShape), then one Polygon per sample
 * square. Properties carry the id, center, elevation/aspect/slope and every
 * CSV extra column so the page can build the /balloon form URL.
 */
public class PlotGeoJsonBuilder {

	private final ObjectMapper mapper = new ObjectMapper();

	public String toFeature(SimplePlacemarkObject plot) throws Exception {
		Map<String, Object> feature = new LinkedHashMap<>();
		feature.put("type", "Feature");
		try {
			feature.put("geometry", geometry(plot));
		} catch (RuntimeException e) {
			throw new IllegalArgumentException("Invalid geometry for plot " + plot.getPlacemarkId(), e);
		}
		feature.put("properties", properties(plot));
		return mapper.writeValueAsString(feature);
	}

	private Map<String, Object> geometry(SimplePlacemarkObject plot) {
		List<Map<String, Object>> geometries = new ArrayList<>();
		if (plot.getMultiShape() != null) {
			for (List<SimpleCoordinate> ring : plot.getMultiShape()) {
				Map<String, Object> poly = polygon(ring);
				if (poly != null) {
					geometries.add(poly);
				}
			}
		}
		if (plot.getPoints() != null) {
			for (SimplePlacemarkObject sample : plot.getPoints()) {
				Map<String, Object> poly = polygon(sample.getShape());
				if (poly != null) {
					geometries.add(poly);
				}
			}
		}
		Map<String, Object> geom = new LinkedHashMap<>();
		geom.put("type", "GeometryCollection");
		geom.put("geometries", geometries);
		return geom;
	}

	private Map<String, Object> polygon(List<SimpleCoordinate> ring) {
		// Skip degenerate rings: a Polygon needs at least 3 vertices.
		if (ring == null || ring.size() < 3) {
			return null;
		}
		List<double[]> coords = new ArrayList<>();
		for (SimpleCoordinate c : ring) {
			coords.add(new double[] { Double.parseDouble(c.getLongitude()), Double.parseDouble(c.getLatitude()) });
		}
		// GeoJSON polygons must be closed
		double[] first = coords.get(0);
		double[] last = coords.get(coords.size() - 1);
		if (first[0] != last[0] || first[1] != last[1]) {
			coords.add(first);
		}
		Map<String, Object> poly = new LinkedHashMap<>();
		poly.put("type", "Polygon");
		poly.put("coordinates", new Object[] { coords });
		return poly;
	}

	private Map<String, Object> properties(SimplePlacemarkObject plot) {
		Map<String, Object> props = new LinkedHashMap<>();
		props.put("id", plot.getPlacemarkId());
		if (plot.getCoord() != null) {
			props.put("latitude", plot.getCoord().getLatitude());
			props.put("longitude", plot.getCoord().getLongitude());
		}
		props.put("elevation", plot.getElevation());
		props.put("aspect", plot.getAspect());
		props.put("slope", plot.getSlope());
		// $[region] balloon token: GEP never puts region in ExtendedData either
		// (getRegion() is the LOD bounding box, not balloon data), so an empty
		// string preserves parity and blanks the token instead of leaking
		// "[object Object]" through the form URL.
		props.put("region", "");
		if (plot.getValuesByColumn() != null) {
			// CSV columns must not overwrite id/coordinates used as the plot join key.
			for (Map.Entry<String, String> entry : plot.getValuesByColumn().entrySet()) {
				if (!props.containsKey(entry.getKey())) {
					props.put(entry.getKey(), entry.getValue());
				}
			}
		}
		return props;
	}
}
