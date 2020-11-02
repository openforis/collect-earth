package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class PolygonGeometryGenerator extends AbstractPolygonKmlGenerator {

	protected final Logger logger = LoggerFactory.getLogger(PolygonGeometryGenerator.class);

	public List<List<SimpleCoordinate>> getPolygonsInMultiGeometry(String polygon) {

		List<List<SimpleCoordinate>> polygons = new ArrayList<>();

		if (StringUtils.isBlank(polygon)) {
			throw new IllegalArgumentException("The KML Polygon string cannot be null");
		}

		Geometry geometry = getGeometry(polygon);

		int numGeometries = geometry.getNumGeometries();

		if( numGeometries == 1 ) {
			polygons.add(getPolygonVertices(geometry));
		}else {
			for (int i = 0; i < numGeometries; i++) {
				Geometry geo = geometry.getGeometryN( i );
				polygons.add(getPolygonVertices(geo));
			}
		}

		return polygons;
	}

	protected abstract Geometry getGeometry(String polygon);

	private List<SimpleCoordinate> getPolygonVertices(Geometry geometry) {
		List<SimpleCoordinate> simpleCoordinates = new ArrayList<>();
		for (int i = 0; i < geometry.getCoordinates().length; i++) {
			Coordinate coordinate = geometry.getCoordinates()[i];
			SimpleCoordinate coords = new SimpleCoordinate(coordinate);
			simpleCoordinates.add(coords);
		}
		return simpleCoordinates;
	}

	public PolygonGeometryGenerator(String epsgCode, String hostAddress, String localPort, Integer innerPointSide,
			Integer numberOfPoints, double distanceBetweenSamplePoints, double distancePlotBoundary,
			Integer largeCentralPlotSide, String distanceToBuffers) {
		super(epsgCode, hostAddress, localPort, innerPointSide, numberOfPoints, distanceBetweenSamplePoints,
				distancePlotBoundary, largeCentralPlotSide, distanceToBuffers);
	}

	@Override
	public void fillExternalLine(SimplePlacemarkObject placemark) throws TransformException, KmlGenerationException {
		// Parse the polygon already defined within the placemark.kmlPolygon attribute
		// The resulting object is then used directly in the freemarker template

		if (StringUtils.isBlank(placemark.getPolygon())) {
			throw new KmlGenerationException(
					"The placemark kmlPolygon attribute is empty! There needs to be a column where the <Polygon> value is specified");
		}

		placemark.setMultiShape(getPolygonsInMultiGeometry(placemark.getPolygon()));
	}

	@Override
	public void fillSamplePoints(SimplePlacemarkObject placemark) throws TransformException {
		placemark.setPoints(new ArrayList<SimplePlacemarkObject>());
	}

}