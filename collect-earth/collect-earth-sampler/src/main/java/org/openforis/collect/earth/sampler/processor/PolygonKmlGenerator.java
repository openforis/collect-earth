package org.openforis.collect.earth.sampler.processor;

import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;

public abstract class PolygonKmlGenerator extends KmlGenerator {

	private static final String PLACEMARK_ID_PREFIX = "placemark_";
	protected static final int INNER_RECT_SIDE = 2;
	protected static final int NUM_OF_COLS = 6;
	protected static final int NUM_OF_ROWS = 6;
	private final String host;
	private final String port;
	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	public PolygonKmlGenerator(String epsgCode, String host, String port) {
		super(epsgCode);
		this.host = host;
		this.port = port;
	}

	@Override
	protected Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints)
			throws FileNotFoundException, IOException {
		Map<String, Object> data = new HashMap<String, Object>();

		SimplePlacemarkObject previousPlacemark = null;

		// Read CSV file so that we can store the information in a Map that can
		// be used by freemarker to do the "goal-replacement"
		CSVReader reader = new CSVReader(new FileReader(csvFile), ',');
		String[] nextRow;
		List<SimplePlacemarkObject> placemarks = new ArrayList<SimplePlacemarkObject>();
		while ((nextRow = reader.readNext()) != null) {
			try {

				double originalX = Double.parseDouble(nextRow[1]);
				double originalY = Double.parseDouble(nextRow[2]);

				Point transformedPoint = transformToWGS84(originalX, originalY); // TOP-LEFT

				// This should be the position at the center of the plot
				double[] coordOriginalPoints = new double[] { transformedPoint.getX(), transformedPoint.getY() };
				// Since we use the coordinates with TOP-LEFT anchoring then we
				// need to move the #original point@ to the top left so that
				// the center ends up bein the expected original coord

				String currentPlaceMarkId = PLACEMARK_ID_PREFIX + nextRow[0];
				SimplePlacemarkObject parentPlacemark = new SimplePlacemarkObject(transformedPoint.getCoordinate(),
						currentPlaceMarkId);

				if (previousPlacemark != null) {
					// Give the current ID to the previous placemark so that we
					// can move from placemark to placemark
					previousPlacemark.setNextPlacemarkId(currentPlaceMarkId);
				}

				previousPlacemark = parentPlacemark;
				
				fillSamplePoints(distanceBetweenSamplePoints, coordOriginalPoints,
						currentPlaceMarkId, parentPlacemark);

				fillExternalLine(distanceBetweenSamplePoints, coordOriginalPoints, parentPlacemark);

				placemarks.add(parentPlacemark);

			} catch (NumberFormatException e) {
				logger.error("Error in the number formatting", e);
			} catch (Exception e) {
				logger.error("Error in the number formatting", e);
			}

		}
		reader.close();
		data.put("placemarks", placemarks);
		data.put("host", KmlGenerator.getHostAddress(host, port));

		return data;
	}

	protected List<SimpleCoordinate> getSamplePointPolygon(double[] miniPlacemarkPosition) throws TransformException {
		List<SimpleCoordinate> coords = new ArrayList<SimpleCoordinate>();

		coords.add(new SimpleCoordinate(miniPlacemarkPosition)); // TOP-LEFT

		coords.add(new SimpleCoordinate(getPointWithOffset(miniPlacemarkPosition, INNER_RECT_SIDE, 0))); // TOP-RIGHT
		coords.add(new SimpleCoordinate(getPointWithOffset(miniPlacemarkPosition, INNER_RECT_SIDE, INNER_RECT_SIDE))); // BOTTOM-RIGHT
		coords.add(new SimpleCoordinate(getPointWithOffset(miniPlacemarkPosition, 0, INNER_RECT_SIDE))); // BOTTOM-LEFT

		// close the square
		coords.add(new SimpleCoordinate(miniPlacemarkPosition)); // TOP-LEFT
		return coords;
	}
	protected abstract void fillExternalLine(float distanceBetweenSamplePoints, double[] coordOriginalPoints,
			SimplePlacemarkObject parentPlacemark) throws TransformException;


	protected abstract void fillSamplePoints(float distanceBetweenSamplePoints, double[] coordOriginalPoints,
			String currentPlaceMarkId, SimplePlacemarkObject parentPlacemark) throws TransformException;

}
