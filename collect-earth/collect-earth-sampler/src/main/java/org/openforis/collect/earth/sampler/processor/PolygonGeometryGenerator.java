package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.io.kml.KMLWriter;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;

public abstract class PolygonGeometryGenerator extends AbstractPolygonGeometryKmlGenerator {
	private KMLWriter kmlWriter;

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
		if (StringUtils.isBlank(placemark.getKmlPolygon())) {
			throw new KmlGenerationException(
					"The placemark kmlPolygon attribute is empty! There needs to be a column where the <Polygon> value is specified");
		}
		final Geometry geometry = getGeometry(placemark.getKmlPolygon());

		placemark.setKmlPolygon(getGeometryAsKML(geometry));

		placemark.setMultiShape(getPolygonsInMultiGeometry(geometry));
	}

	protected abstract Geometry getGeometry(String polygon);

	public String getGeometryAsKML(Geometry geom) {
		kmlWriter = kmlWriter != null ? kmlWriter : new KMLWriter();

		final String kml = kmlWriter.write(geom);
		return normalizeKML(kml);

	}

	public List<List<SimpleCoordinate>> getPolygonsInMultiGeometry(String polygonString) {

		return getPolygonsInMultiGeometry( getGeometry( polygonString ) );
	}

	public List<List<SimpleCoordinate>> getPolygonsInMultiGeometry(Geometry geometry) {

		final List<List<SimpleCoordinate>> polygons = new ArrayList<>();

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

	private String normalizeKML(String kml) {
		final String condenseSpace = kml.replaceAll("\\s+", " ").trim();
		final String removeRedundantSpace = condenseSpace.replaceAll("> <", "><");
		return removeRedundantSpace;
	}

}