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
		feature.put("geometry", geometry(plot));
		feature.put("properties", properties(plot));
		return mapper.writeValueAsString(feature);
	}

	private Map<String, Object> geometry(SimplePlacemarkObject plot) {
		List<Map<String, Object>> geometries = new ArrayList<>();
		if (plot.getMultiShape() != null) {
			for (List<SimpleCoordinate> ring : plot.getMultiShape()) {
				geometries.add(polygon(ring));
			}
		}
		if (plot.getPoints() != null) {
			for (SimplePlacemarkObject sample : plot.getPoints()) {
				if (sample.getShape() != null && !sample.getShape().isEmpty()) {
					geometries.add(polygon(sample.getShape()));
				}
			}
		}
		Map<String, Object> geom = new LinkedHashMap<>();
		geom.put("type", "GeometryCollection");
		geom.put("geometries", geometries);
		return geom;
	}

	private Map<String, Object> polygon(List<SimpleCoordinate> ring) {
		List<double[]> coords = new ArrayList<>();
		for (SimpleCoordinate c : ring) {
			coords.add(new double[] { Double.parseDouble(c.getLongitude()), Double.parseDouble(c.getLatitude()) });
		}
		// GeoJSON polygons must be closed
		if (!coords.isEmpty()) {
			double[] first = coords.get(0);
			double[] last = coords.get(coords.size() - 1);
			if (first[0] != last[0] || first[1] != last[1]) {
				coords.add(first);
			}
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
		if (plot.getValuesByColumn() != null) {
			props.putAll(plot.getValuesByColumn());
		}
		return props;
	}
}
