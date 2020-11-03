package org.openforis.collect.earth.sampler.processor;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.io.FileUtils;
import org.apache.commons.lang.StringEscapeUtils;
import org.apache.commons.lang.StringUtils;
import org.locationtech.jts.geom.Point;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.FreemarkerTemplateUtils;
import org.openforis.collect.earth.sampler.utils.GeoUtils;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.openforis.collect.metamodel.CollectAnnotations;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.AttributeDefinition;
import org.opengis.referencing.FactoryException;
import org.opengis.referencing.operation.TransformException;

public abstract class KmlGenerator extends AbstractCoordinateCalculation {

	protected void fillPolygonProperties(SimplePlacemarkObject plotProperties, String kmlPolygon,
			List<List<SimpleCoordinate>> pointsInPolygon) {
		plotProperties.setMultiShape(pointsInPolygon);
		if (!pointsInPolygon.isEmpty()) {
			plotProperties.setKmlPolygon(kmlPolygon);
			plotProperties.setCoord(getCentroid(plotProperties.getShape()));
		}
	}

	private static SimpleCoordinate getCentroid(List<SimpleCoordinate> shape) {

		double centroidX = 0;
		double centroidY = 0;

		for (SimpleCoordinate knot : shape) {
			centroidX += knot.getCoordinates()[1];
			centroidY += knot.getCoordinates()[0];
		}
		return new SimpleCoordinate(centroidY / shape.size(), centroidX / shape.size());

	}

	public static String getCsvFileName(String csvFilePath) {
		final File csvFile = new File(csvFilePath);
		if (csvFile.exists()) {
			return csvFile.getName();
		} else {
			return "No CSV file found";
		}
	}

	/**
	 * Checks if the given String represents a number
	 *
	 * @param string The String to check
	 * @return True if the string is a number
	 */
	public static boolean isNumber(String string) {
		if (string == null || string.isEmpty()) {
			return false;
		}
		int i = 0;
		if (string.charAt(0) == '-') {
			if (string.length() > 1) {
				i++;
			} else {
				return false;
			}
		}
		for (; i < string.length(); i++) {
			char charAt = string.charAt(i);
			if (charAt != '.' && charAt != ',' && !Character.isDigit(charAt)) {
				return false;
			}
		}
		return true;
	}

	private static String[] removeTrailingSpaces(String[] csvValuesInLine) {
		for (int i = 0; i < csvValuesInLine.length; i++) {
			String val = csvValuesInLine[i];
			csvValuesInLine[i] = val.trim();
		}
		return csvValuesInLine;
	}

	protected String hostAddress;

	private final SimpleDateFormat iso8601Timestamp = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss");

	public KmlGenerator(String epsgCode) {
		super(epsgCode);
	}

	public abstract void fillExternalLine(SimplePlacemarkObject placemark)
			throws TransformException, KmlGenerationException;

	public abstract void fillSamplePoints(SimplePlacemarkObject placemark) throws TransformException;

	public void generateKmlFile(String destinationKmlFile, String csvFile, String balloonFile,
			String freemarkerKmlTemplateFile, CollectSurvey collectSurvey) throws KmlGenerationException {

		final File destinationFile = new File(destinationKmlFile);
		destinationFile.getParentFile().mkdirs();
		getKmlCode(csvFile, balloonFile, freemarkerKmlTemplateFile, destinationFile, collectSurvey);
	}

	private void getKmlCode(String csvFile, String balloonFile, String freemarkerKmlTemplateFile, File destinationFile,
			CollectSurvey collectSurvey) throws KmlGenerationException {

		if (StringUtils.isBlank(csvFile)) {
			throw new IllegalArgumentException("THe CSV file location cannot be null");
		}

		if (StringUtils.isBlank(balloonFile)) {
			throw new IllegalArgumentException("The balloon (Google Earth popup) file location cannot be null");
		}

		if (StringUtils.isBlank(freemarkerKmlTemplateFile)) {
			throw new IllegalArgumentException("The KML freemarker Template file location cannot be null");
		}

		if (collectSurvey == null) {
			throw new IllegalArgumentException(
					"The Collect survey cannot be null. There is an error on the Survey and it was not loaded correctly");
		}

		// Build the data-model
		final Map<String, Object> data = getTemplateData(csvFile, collectSurvey);
		data.put("expiration", iso8601Timestamp.format(new Date()));

		// Get the HTML content of the balloon from a file, this way we can
		// separate the KML generation so it is easier to create different KMLs
		String balloonContents;
		try {
			balloonContents = FileUtils.readFileToString(new File(balloonFile), StandardCharsets.UTF_8);
		} catch (IOException e) {
			throw new KmlGenerationException("Error reading the balloon file " + balloonFile, e);
		}
		try {
			data.put("html_for_balloon", balloonContents);
			// This random number is used as a parameter when the JS and CSS files are
			// referenced so that
			// it forces Google Earth to reload them when the KMZ file changes
			data.put("randomNumber", FreemarkerTemplateUtils.randInt(10000, 5000000));

			// Process the template file using the data in the "data" Map
			final File templateFile = new File(freemarkerKmlTemplateFile);

			FreemarkerTemplateUtils.applyTemplate(templateFile, destinationFile, data);
		} catch (Exception e) {
			throw new KmlGenerationException("Error generating the KML file to open in Google Earth "
					+ freemarkerKmlTemplateFile + " with data " + Arrays.toString(data.values().toArray()), e);
		}
	}

	public SimplePlacemarkObject getPlotObject(String[] csvValuesInLine, String[] possibleColumnNames,
			CollectSurvey collectSurvey) throws KmlGenerationException, TransformException, FactoryException {

		List<AttributeDefinition> keyAttributeDefinitions = collectSurvey.getSchema().getRootEntityDefinitions().get(0)
				.getKeyAttributeDefinitions();
		int numberOfKeyAttributes = keyAttributeDefinitions.size();

		CollectAnnotations annotations = collectSurvey.getAnnotations();

		csvValuesInLine = removeTrailingSpaces(csvValuesInLine);

		SimplePlacemarkObject plotProperties = new SimplePlacemarkObject();

		StringBuilder keys = new StringBuilder("");
		StringBuilder visibleKeys = new StringBuilder("");
		for (int i = 0; i < numberOfKeyAttributes; i++) {
			keys = keys.append(csvValuesInLine[i]).append(",");
			boolean isKeyHiddenInGoogleEarth = annotations
					.isHideKeyInCollectEarthRecordList(keyAttributeDefinitions.get(i));
			// Check that the Key attribute should not be hidden to user...
			// This is helpful to have blind Quality Control plots
			if (!isKeyHiddenInGoogleEarth) {
				visibleKeys = visibleKeys.append(csvValuesInLine[i]).append(",");
			}
		}

		plotProperties.setPlacemarkId(keys.substring(0, keys.lastIndexOf(",")));
		plotProperties.setVisiblePlacemarkId(visibleKeys.substring(0, visibleKeys.lastIndexOf(",")));

		int leadingColumns = 0;

		String longitude = csvValuesInLine[numberOfKeyAttributes + 1].replace(',', '.').trim();
		String latitude = csvValuesInLine[numberOfKeyAttributes].replace(',', '.').trim();
		if (isNumber(longitude) && isNumber(latitude)) {
			plotProperties.setCoord(new SimpleCoordinate(latitude, longitude));
			leadingColumns = 2;
		} else {
			throw new KmlGenerationException(
					" The latitude and longitude columns contain values other than numbers : LAT : " + latitude
							+ " , LONG :" + longitude);
		}

		processPolygonProperties(plotProperties, csvValuesInLine);

		ArrayList<String> extraInfoVector = new ArrayList<>();
		ArrayList<String> extraColumns = new ArrayList<>();
		int columnsWithIfAndLocationInfo = leadingColumns + numberOfKeyAttributes;
		if (csvValuesInLine.length > columnsWithIfAndLocationInfo) {
			// Add all extra columns
			for (int extraIndex = leadingColumns
					+ numberOfKeyAttributes; extraIndex < csvValuesInLine.length; extraIndex++) {

				// DO NOT INCLUDE THE POLYGONS IN THE EXTRA DATA AS THEY WILL MAKE THE KML
				// REALLY LARGE!

				if ( extraIndex == getColumnWithPolygonString() ) {
					extraColumns.add("Polygon used in the placemark not included.");
				} else {
					extraColumns.add(StringEscapeUtils.escapeXml(csvValuesInLine[extraIndex]));
				}

			}

			// THIS IS ONLY FOR OLD SURVEYS!!!
			if (csvValuesInLine.length > 5 + numberOfKeyAttributes) {
				for (int extraIndex = 5 + numberOfKeyAttributes; extraIndex < csvValuesInLine.length; extraIndex++) {
					extraInfoVector.add(StringEscapeUtils.escapeXml(csvValuesInLine[extraIndex]));
				}
			}
		}

		String[] extraInfoArray = new String[extraInfoVector.size()];
		String[] extraColumnArray = new String[extraColumns.size()];
		String[] idColumnArray = new String[numberOfKeyAttributes];
		for (int i = 0; i < numberOfKeyAttributes; i++) {
			idColumnArray[i] = csvValuesInLine[i];
		}

		plotProperties.setExtraInfo(extraInfoVector.toArray(extraInfoArray));
		plotProperties.setExtraColumns(extraColumns.toArray(extraColumnArray));
		plotProperties.setIdColumns(idColumnArray);

		// Adds a map ( coulmnName,cellValue) so that the values can also be added to
		// the KML by column name (for the newer versions)
		HashMap<String, String> valuesByColumn = new HashMap<>();
		if (possibleColumnNames != null) {
			for (int i = 0; i < possibleColumnNames.length; i++) {
				valuesByColumn.put(possibleColumnNames[i], csvValuesInLine[i] == null ? "" : csvValuesInLine[i]);
			}
		}
		plotProperties.setValuesByColumn(valuesByColumn);

		// Handle teh calculation of different SRSs that EPSG:3264
		// Lets keep a copy of the original coordinates to use on the KML Data for
		// long/lat that will be sent to Collect Earth
		plotProperties.setOriginalLongitude(plotProperties.getCoord().getLongitude());
		plotProperties.setOriginalLatitude(plotProperties.getCoord().getLatitude());

		String sourceEpsgCode = collectSurvey.getSpatialReferenceSystems().get(0).getId();

		if (!GeoUtils.isUsingWGS84(sourceEpsgCode)) {
			final Point transformedPoint = GeoUtils.transformToWGS84(
					Double.parseDouble(plotProperties.getCoord().getLongitude()),
					Double.parseDouble(plotProperties.getCoord().getLatitude()), sourceEpsgCode); // TOP-LEFT
			plotProperties.setCoord(new SimpleCoordinate(transformedPoint.getY(), transformedPoint.getX()));
		}

		return plotProperties;
	}

	protected int getColumnWithPolygonString() {
		// For all the classes of generators that do not use KML/GeoJson/WKT polygons
		return -1;
	}

	protected abstract Map<String, Object> getTemplateData(String csvFile, CollectSurvey collectSurvey)
			throws KmlGenerationException;

	protected void processPolygonProperties(SimplePlacemarkObject plotProperties, String[] csvValuesInLine) {
		// To be used in the KML/WKT and GeoJson kml generators
	}

}