package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.LoggerFactory;

public class PolygonKmlGenerator extends AbstractPolygonKmlGenerator {

	private static final String COORDINATES_END = "</coordinates>";
	private static final String COORDINATES_START = "<coordinates>";
	private static final String LINEARRING_END = "</linearring>";
	private static final String LINEARRING_START = "<linearring>";
	private static final String MULTIGEOMETRY_END = "</multigeometry>";
	private static final String MULTIGEOMETRY_START = "<multigeometry>";
	private static final String POLYGON_END = "</polygon>";
	private static final String POLYGON_START = "<polygon>";

	private static String extractXmlTextValue(String lowerCase, String startXmlTag, String endXmlTag) {
		int startOfXmlTag = lowerCase.indexOf(startXmlTag);
		int endOfXmlTag = lowerCase.indexOf(endXmlTag);
		String valueAttr = "";
		try {
			if (startOfXmlTag != -1 && endOfXmlTag != -1) {
				valueAttr = lowerCase.substring(startOfXmlTag + startXmlTag.length(), endOfXmlTag);
			}
		} catch (Exception e) {
			LoggerFactory.getLogger(PolygonKmlGenerator.class).error( String.format("error with %s", lowerCase ), e);
		}
		return valueAttr;
	}

	public static List<List<SimpleCoordinate>> getPolygonsInMultiGeometry(String kmlPolygon) {

		List<List<SimpleCoordinate>> polygons = new ArrayList<>();

		if (StringUtils.isBlank(kmlPolygon)) {
			throw new IllegalArgumentException("The KML Polygon string cannot be null");
		}
		String lowerCase = kmlPolygon.toLowerCase();

		// If there are multiple polygons or lines
		if (lowerCase.contains(MULTIGEOMETRY_START)) {
			String geometries = extractXmlTextValue(lowerCase, MULTIGEOMETRY_START, MULTIGEOMETRY_END);
			int lastFoundPolygon = geometries.indexOf(POLYGON_START, 0);
			while (lastFoundPolygon > -1) {

				String polygon = extractXmlTextValue(geometries.substring(lastFoundPolygon), POLYGON_START,
						POLYGON_END);

				polygons.add(getPolygonVertices(polygon));

				lastFoundPolygon = geometries.indexOf(POLYGON_START, lastFoundPolygon + POLYGON_START.length());
			}
		} else {
			polygons.add(getPolygonVertices(lowerCase));
		}
		return polygons;
	}

	private static List<SimpleCoordinate> getPolygonVertices(String lowerCase) {
		String valueAttr = extractXmlTextValue(lowerCase, LINEARRING_START, LINEARRING_END);
		valueAttr = extractXmlTextValue(valueAttr, COORDINATES_START, COORDINATES_END);
		List<SimpleCoordinate> simpleCoordinates = new ArrayList<>();
		// Coordinates look like this : lat,long,elev lat,long,elev ...
		// -15.805135,16.389028,0.0 -15.804454,16.388447,0.0

		String[] splitGroup = valueAttr.split(" ");
		if (splitGroup.length == 1) {
			splitGroup = valueAttr.split("\n");
		}

		for (String coordsWithElev : splitGroup) {
			String[] splitCoord = coordsWithElev.split(",");
			if (splitCoord.length > 1) {
				SimpleCoordinate coords = new SimpleCoordinate(splitCoord[1], splitCoord[0]);
				simpleCoordinates.add(coords);
			}
		}
		return simpleCoordinates;
	}

	public PolygonKmlGenerator(String epsgCode, String hostAddress, String localPort) {
		super(epsgCode, hostAddress, localPort, 0, 0, 0, 0, (Integer) null, null);

	}

	@Override
	public void fillExternalLine(SimplePlacemarkObject placemark) throws TransformException, KmlGenerationException {
		// Parse the polygon already defined within the placemark.kmlPolygon attribute
		// The resulting object is then used directly in the freemarker template
		if (StringUtils.isBlank(placemark.getPolygon())) {
			throw new KmlGenerationException(
					"The placemark kmlPolygon attribute is empty! There needs to be a column where the <Polygon> value is specified");
		}

		placemark.setMultiShape(PolygonKmlGenerator.getPolygonsInMultiGeometry(placemark.getPolygon()));
	}

	@Override
	public void fillSamplePoints(SimplePlacemarkObject placemark) throws TransformException {
		placemark.setPoints(new ArrayList<SimplePlacemarkObject>());
	}

}
