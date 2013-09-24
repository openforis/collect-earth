package org.openforis.collect.earth.sampler.processor;

import java.awt.geom.Rectangle2D;
import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
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

	private static final Integer DEFAULT_INNER_POINT_SIDE = 2;
	private Integer innerPointSide;
	protected static final int NUM_OF_COLS = 6;
	protected static final int NUM_OF_ROWS = 6;
	private final String host;
	private final String port;
	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	public PolygonKmlGenerator(String epsgCode, String host, String port, Integer innerPointSide) {
		super(epsgCode);
		this.host = host;
		this.port = port;
		this.innerPointSide = innerPointSide;
	}

	@Override
	protected Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints, float distancePlotBoundary)
			throws IOException {
		Map<String, Object> data = new HashMap<String, Object>();

		SimplePlacemarkObject previousPlacemark = null;

		
		Rectangle2D viewFrame = new Rectangle2D.Float();
		boolean firstPoint = true;
		// Read CSV file so that we can store the information in a Map that can
		// be used by freemarker to do the "goal-replacement"
		String[] nextRow;

		CSVReader reader = null;
		List<SimplePlacemarkObject> placemarks = null;
		try {
			BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(new FileInputStream(csvFile),
					Charset.forName("UTF-8")));
			reader = new CSVReader(bufferedReader, ',');
			placemarks = new ArrayList<SimplePlacemarkObject>();
			while ((nextRow = reader.readNext()) != null) {
				try {

					double originalX = Double.parseDouble(nextRow[1]);
					double originalY = Double.parseDouble(nextRow[2]);
					Integer elevation = 0;
					double slope = 0;
					double aspect = 0;
					if( nextRow.length > 3 ){
						elevation = Integer.parseInt(nextRow[3]);
						slope = Double.parseDouble(nextRow[4]);
						aspect = Double.parseDouble(nextRow[5]);
					}

					Point transformedPoint = transformToWGS84(originalX, originalY); // TOP-LEFT

					if (firstPoint) {
						viewFrame.setRect(transformedPoint.getX(), transformedPoint.getY(), 0, 0);
						firstPoint = false;
					} else {
						Rectangle2D rectTemp = new Rectangle2D.Float();
						rectTemp.setRect(transformedPoint.getX(), transformedPoint.getY(), 0, 0);
						viewFrame = viewFrame.createUnion(rectTemp);
					}


					// This should be the position at the center of the plot
					double[] coordOriginalPoints = new double[] { transformedPoint.getX(), transformedPoint.getY() };
					// Since we use the coordinates with TOP-LEFT anchoring then
					// we
					// need to move the #original point@ to the top left so that
					// the center ends up bein the expected original coord

					String currentPlaceMarkId = nextRow[0];
					SimplePlacemarkObject parentPlacemark = new SimplePlacemarkObject(transformedPoint.getCoordinate(),
							currentPlaceMarkId, elevation, slope, aspect);

					if (previousPlacemark != null) {
						// Give the current ID to the previous placemark so that
						// we can move from placemark to placemark
						previousPlacemark.setNextPlacemarkId(currentPlaceMarkId);
					}

					previousPlacemark = parentPlacemark;

					fillSamplePoints(distanceBetweenSamplePoints, coordOriginalPoints, currentPlaceMarkId, parentPlacemark);

					fillExternalLine(distanceBetweenSamplePoints, distancePlotBoundary, coordOriginalPoints, parentPlacemark);

					placemarks.add(parentPlacemark);

				} catch (NumberFormatException e) {
					logger.error("Error in the number formatting", e);
				} catch (Exception e) {
					logger.error("Error in the number formatting", e);
				}
			}
		} catch (Exception e) {
			logger.error("Error reading CSV", e);
		} finally {
			if (reader != null) {
				reader.close();
			}
		}

		data.put("placemarks", placemarks);
		data.put("region_north", viewFrame.getMaxY() + "");
		data.put("region_south", viewFrame.getMinY() + "");
		data.put("region_west", viewFrame.getMinX() + "");
		data.put("region_east", viewFrame.getMaxX() + "");
		data.put("region_center_X", viewFrame.getCenterX() + "");
		data.put("region_center_Y", viewFrame.getCenterY() + "");
		data.put("host", KmlGenerator.getHostAddress(host, port));

		return data;
	}

	protected List<SimpleCoordinate> getSamplePointPolygon(double[] topLeftPosition, int samplePointSide)
			throws TransformException {
		List<SimpleCoordinate> coords = new ArrayList<SimpleCoordinate>();
		coords.add(new SimpleCoordinate(topLeftPosition)); // TOP-LEFT
		coords.add(new SimpleCoordinate(getPointWithOffset(topLeftPosition, samplePointSide, 0))); // TOP-RIGHT
		coords.add(new SimpleCoordinate(getPointWithOffset(topLeftPosition, samplePointSide, samplePointSide))); // BOTTOM-RIGHT
		coords.add(new SimpleCoordinate(getPointWithOffset(topLeftPosition, 0, samplePointSide))); // BOTTOM-LEFT

		// close the square
		coords.add(new SimpleCoordinate(topLeftPosition)); // TOP-LEFT
		return coords;
	}

	protected abstract void fillExternalLine(float distanceBetweenSamplePoints, float distancePlotBoundary,
			double[] coordOriginalPoints,
			SimplePlacemarkObject parentPlacemark) throws TransformException;


	protected abstract void fillSamplePoints(float distanceBetweenSamplePoints,
			double[] coordOriginalPoints, String currentPlaceMarkId, SimplePlacemarkObject parentPlacemark)
			throws TransformException;

	protected int getPointSide() {
		if (innerPointSide == null) {
			innerPointSide = DEFAULT_INNER_POINT_SIDE;
		}
		return innerPointSide;
	}

}
