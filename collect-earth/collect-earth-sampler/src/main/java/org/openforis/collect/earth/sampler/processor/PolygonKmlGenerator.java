package org.openforis.collect.earth.sampler.processor;

import java.awt.geom.Rectangle2D;
import java.io.IOException;
import java.text.DecimalFormat;
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
	private final String host;
	private final String port;
	private final String localPort;
	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	public PolygonKmlGenerator(String epsgCode, String host, String port, String localPort, Integer innerPointSide) {
		super(epsgCode);
		this.host = host;
		this.port = port;
		this.localPort = localPort;
		this.innerPointSide = innerPointSide;
	}

	abstract int getNumOfRows();

	protected int getPointSide() {
		if (innerPointSide == null) {
			innerPointSide = DEFAULT_INNER_POINT_SIDE;
		}
		return innerPointSide;
	}

	protected List<SimpleCoordinate> getSamplePointPolygon(double[] topLeftPositionLatLong, int samplePointSide) throws TransformException {
		final List<SimpleCoordinate> coords = new ArrayList<SimpleCoordinate>();
		coords.add(new SimpleCoordinate(topLeftPositionLatLong)); // TOP-LEFT
		coords.add(new SimpleCoordinate(getPointWithOffset(topLeftPositionLatLong, samplePointSide, 0))); // TOP-RIGHT
		coords.add(new SimpleCoordinate(getPointWithOffset(topLeftPositionLatLong, samplePointSide, samplePointSide))); // BOTTOM-RIGHT
		coords.add(new SimpleCoordinate(getPointWithOffset(topLeftPositionLatLong, 0, samplePointSide))); // BOTTOM-LEFT

		// close the square
		coords.add(new SimpleCoordinate(topLeftPositionLatLong)); // TOP-LEFT
		return coords;
	}

	@Override
	protected Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints, float distancePlotBoundary) throws IOException {
		final Map<String, Object> data = new HashMap<String, Object>();

		SimplePlacemarkObject previousPlacemark = null;

		Rectangle2D viewFrame = new Rectangle2D.Float();
		boolean firstPoint = true;
		// Read CSV file so that we can store the information in a Map that can
		// be used by freemarker to do the "goal-replacement"
		String[] csvRow;
		String[] headerRow =null;

		CSVReader reader = null;
		List<SimplePlacemarkObject> placemarks = new ArrayList<SimplePlacemarkObject>();
		try {
			reader = getCsvReader(csvFile);
			
			while ((csvRow = reader.readNext()) != null) {
				try {
					if( headerRow == null ){
						headerRow = csvRow;
					}
					final PlotProperties plotProperties = getPlotProperties(csvRow, headerRow);

					final Point transformedPoint = transformToWGS84(plotProperties.xCoord, plotProperties.yCoord); // TOP-LEFT

					if (firstPoint) {
						viewFrame.setRect(transformedPoint.getX(), transformedPoint.getY(), 0, 0);
						firstPoint = false;
					} else {
						final Rectangle2D rectTemp = new Rectangle2D.Float();
						rectTemp.setRect(transformedPoint.getX(), transformedPoint.getY(), 0, 0);
						viewFrame = viewFrame.createUnion(rectTemp);
					}

					// This should be the position at the center of the plot
					final double[] originalLatLong = new double[] { transformedPoint.getY(), transformedPoint.getX() };
					// Since we use the coordinates with TOP-LEFT anchoring then
					// we
					// need to move the #original point@ to the top left so that
					// the center ends up being the expected original coord

					final SimplePlacemarkObject parentPlacemark = new SimplePlacemarkObject(transformedPoint.getCoordinate(), plotProperties);

					if (previousPlacemark != null) {
						// Give the current ID to the previous placemark so that
						// we can move from placemark to placemark
						previousPlacemark.setNextPlacemarkId(plotProperties.id);
					}

					previousPlacemark = parentPlacemark;

					fillSamplePoints(distanceBetweenSamplePoints, originalLatLong, plotProperties.id, parentPlacemark);

					fillExternalLine(distanceBetweenSamplePoints, distancePlotBoundary, originalLatLong, parentPlacemark);

					placemarks.add(parentPlacemark);

				} catch (final NumberFormatException e) {
					logger.error("Error in the number formatting", e);
				} catch (final Exception e) {
					logger.error("Error in the number formatting", e);
				}
			}
		} catch (final Exception e) {
			logger.error("Error reading CSV", e);
		} finally {
			if (reader != null) {
				reader.close();
			}
		}

		final DecimalFormat df = new DecimalFormat("#.###");

		data.put("placemarks", placemarks);
		data.put("region_north", viewFrame.getMaxY() + "");
		data.put("region_south", viewFrame.getMinY() + "");
		data.put("region_west", viewFrame.getMinX() + "");
		data.put("region_east", viewFrame.getMaxX() + "");
		data.put("region_center_X", df.format(viewFrame.getCenterX()));
		data.put("region_center_Y", df.format(viewFrame.getCenterY()));
		data.put("host", KmlGenerator.getHostAddress(host, port));
		data.put("local_port", localPort );
		data.put("plotFileName", KmlGenerator.getCsvFileName(csvFile));
		return data;
	}

}
