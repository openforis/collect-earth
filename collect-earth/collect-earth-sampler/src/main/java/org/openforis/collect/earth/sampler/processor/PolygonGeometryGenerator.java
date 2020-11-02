package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class PolygonGeometryGenerator extends AbstractPolygonGeometryKmlGenerator {

	protected final Logger logger = LoggerFactory.getLogger(PolygonGeometryGenerator.class);

	public PolygonGeometryGenerator(String epsgCode, String hostAddress, String localPort, Integer innerPointSide,
			Integer numberOfPoints, double distanceBetweenSamplePoints, double distancePlotBoundary,
			Integer largeCentralPlotSide, String distanceToBuffers) {
		super(epsgCode, hostAddress, localPort, innerPointSide, numberOfPoints, distanceBetweenSamplePoints,
				distancePlotBoundary, largeCentralPlotSide, distanceToBuffers);
	}

	protected abstract Geometry getGeometry(String polygon);

	public List<List<SimpleCoordinate>> getPolygonsInMultiGeometry(String polygon) {

		final List<List<SimpleCoordinate>> polygons = new ArrayList<>();

		if (StringUtils.isBlank(polygon)) {
			throw new IllegalArgumentException("The KML Polygon string cannot be null");
		}

		final Geometry geometry = getGeometry(polygon);

		final int numGeometries = geometry.getNumGeometries();

		if (numGeometries == 1) {
			polygons.add(getPolygonVertices(geometry));
		} else {
			for (int i = 0; i < numGeometries; i++) {
				final Geometry geo = geometry.getGeometryN(i);
				polygons.add(getPolygonVertices(geo));
			}
		}

		return polygons;
	}

	private List<SimpleCoordinate> getPolygonVertices(Geometry geometry) {
		final List<SimpleCoordinate> simpleCoordinates = new ArrayList<>();
		for (int i = 0; i < geometry.getCoordinates().length; i++) {
			final Coordinate coordinate = geometry.getCoordinates()[i];
			final SimpleCoordinate coords = new SimpleCoordinate(coordinate);
			simpleCoordinates.add(coords);
		}
		return simpleCoordinates;
	}

}