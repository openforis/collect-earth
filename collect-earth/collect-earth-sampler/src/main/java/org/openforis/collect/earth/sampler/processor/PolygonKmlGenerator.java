package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.slf4j.LoggerFactory;

public class PolygonKmlGenerator extends AbstractPolygonGeometryKmlGenerator {

	static final String COORDINATES_END = "</coordinates>";
	static final String COORDINATES_START = "<coordinates>";
	static final String LINEARRING_END = "</linearring>";
	static final String LINEARRING_START = "<linearring>";
	static final String MULTIGEOMETRY_END = "</multigeometry>";
	static final String MULTIGEOMETRY_START = "<multigeometry>";
	static final String POLYGON_END = "</polygon>";
	static final String POLYGON_START = "<polygon>";
	private static final String KML_POLYGON = "<polygon>";

	static String extractXmlTextValue(String lowerCase, String startXmlTag, String endXmlTag) {
		final int startOfXmlTag = lowerCase.indexOf(startXmlTag);
		final int endOfXmlTag = lowerCase.indexOf(endXmlTag);
		String valueAttr = "";
		try {
			if (startOfXmlTag != -1 && endOfXmlTag != -1) {
				valueAttr = lowerCase.substring(startOfXmlTag + startXmlTag.length(), endOfXmlTag);
			}
		} catch (final Exception e) {
			LoggerFactory.getLogger(PolygonKmlGenerator.class).error(String.format("error with %s", lowerCase), e);
		}
		return valueAttr;
	}

	private static boolean isKmlPolygon(String value) {
		return value.toLowerCase().contains(KML_POLYGON);
	}

	/*
	 * Find the column containing a kml Polygon information
	 *
	 * @param csvValues
	 *
	 * @return Returns the value in the array of the String containing the KML
	 * <Polygon> element, null if there is none
	 */
	public String isKmlPolygonColumnFound(String[] csvValues) {
		for (int i = 0; i < csvValues.length; i++) {
			String value = csvValues[i];
			if (isKmlPolygon(value)) {
				setColumnWithPolygonString( i );
				return value;
			}
		}
		return null;
	}

	public PolygonKmlGenerator(String epsgCode, String hostAddress, String localPort) {
		super(epsgCode, hostAddress, localPort, 0, 0, 0, 0, (Integer) null, null);

	}

	@Override
	public List<List<SimpleCoordinate>> getPolygonsInMultiGeometry(String kmlPolygon) {

		final List<List<SimpleCoordinate>> polygons = new ArrayList<>();

		if (StringUtils.isBlank(kmlPolygon)) {
			throw new IllegalArgumentException("The KML Polygon string cannot be null");
		}
		final String lowerCase = kmlPolygon.toLowerCase();

		// If there are multiple polygons or lines
		if (lowerCase.contains(MULTIGEOMETRY_START)) {
			final String geometries = extractXmlTextValue(lowerCase, MULTIGEOMETRY_START, MULTIGEOMETRY_END);
			int lastFoundPolygon = geometries.indexOf(POLYGON_START, 0);
			while (lastFoundPolygon > -1) {

				final String polygon = extractXmlTextValue(geometries.substring(lastFoundPolygon), POLYGON_START,
						POLYGON_END);

				polygons.add(getPolygonVertices(polygon));

				lastFoundPolygon = geometries.indexOf(POLYGON_START, lastFoundPolygon + POLYGON_START.length());
			}
		} else {
			polygons.add(getPolygonVertices(lowerCase));
		}
		return polygons;
	}

	private List<SimpleCoordinate> getPolygonVertices(String lowerCase) {
		String valueAttr = extractXmlTextValue(lowerCase, LINEARRING_START, LINEARRING_END);
		valueAttr = extractXmlTextValue(valueAttr, COORDINATES_START, COORDINATES_END);
		final List<SimpleCoordinate> simpleCoordinates = new ArrayList<>();
		// Coordinates look like this : lat,long,elev lat,long,elev ...
		// -15.805135,16.389028,0.0 -15.804454,16.388447,0.0

		String[] splitGroup = valueAttr.split(" ");
		if (splitGroup.length == 1) {
			splitGroup = valueAttr.split("\n");
		}

		for (final String coordsWithElev : splitGroup) {
			final String[] splitCoord = coordsWithElev.split(",");
			if (splitCoord.length > 1) {
				final SimpleCoordinate coords = new SimpleCoordinate(splitCoord[1], splitCoord[0]);
				simpleCoordinates.add(coords);
			}
		}
		return simpleCoordinates;
	}

	@Override
	protected void processPolygonProperties(SimplePlacemarkObject plotProperties, String[] csvValuesInLine) {
		final String polygon = isKmlPolygonColumnFound(csvValuesInLine);
		processKmlPolygonProperties(plotProperties, polygon);
	}

}
