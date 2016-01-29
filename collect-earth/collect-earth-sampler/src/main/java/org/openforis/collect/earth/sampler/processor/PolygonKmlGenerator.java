package org.openforis.collect.earth.sampler.processor;

import java.awt.geom.Rectangle2D;
import java.io.IOException;
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.core.utils.CsvReaderUtils;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.openforis.collect.model.CollectSurvey;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;

public abstract class PolygonKmlGenerator extends KmlGenerator {

	private static final Integer DEFAULT_INNER_POINT_SIDE = 2;
	private Integer innerPointSide;

	private final String localPort;
	private final Logger logger = LoggerFactory.getLogger(this.getClass());

	public PolygonKmlGenerator(String epsgCode, String hostAddress, String localPort, Integer innerPointSide) {
		super(epsgCode);
		this.hostAddress = hostAddress;
		
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
	protected Map<String, Object> getTemplateData(String csvFile, double distanceBetweenSamplePoints, double distancePlotBoundary, CollectSurvey collectSurvey) throws KmlGenerationException {
		final Map<String, Object> data = new HashMap<String, Object>();

		SimplePlacemarkObject previousPlacemark = null;

		Rectangle2D viewFrame = new Rectangle2D.Float();
		boolean firstPoint = true;
		// Read CSV file so that we can store the information in a Map that can
		// be used by freemarker to do the "goal-replacement"
		String[] csvRow;
		String[] headerRow =null;
		int rowNumber = 0 ;

		CSVReader reader = null;
		List<SimplePlacemarkObject> placemarks = new ArrayList<SimplePlacemarkObject>();
		try {
			reader = CsvReaderUtils.getCsvReader(csvFile);
			
			while ((csvRow = reader.readNext()) != null) {
				try {
					if( headerRow == null ){
						headerRow = csvRow;
					}
					
					// Check that the row is not just an empty row with no data
					if( CsvReaderUtils.onlyEmptyCells(csvRow)){
						// If the row is empty ( e.g. : ",,,,," ) jump to next row
						continue;
					}
					
					final PlotProperties plotProperties = getPlotProperties(csvRow, headerRow, collectSurvey);

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

				} catch (final Exception e) {
					if(rowNumber > 0 ){
						logger.error( "Error on the CSV file ", e );
						throw new KmlGenerationException("Error in the CSV " + csvFile + " \r\n for row " + rowNumber + " = " + Arrays.toString( csvRow ), e);
					}else{
						logger.info("Error while reading the first line of the CSV fle, probably cause by the column header names");
					}
				}finally{
					rowNumber++;
				}
			}
		} catch (final IOException e) {
			throw new KmlGenerationException("Error reading CSV " + csvFile , e);
		} finally {
			if (reader != null) {
				try {
					reader.close();
				} catch (IOException e) {
					logger.error("error closing the CSV reader", e);
				}
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
		data.put("host", hostAddress);
		data.put("local_port", localPort );
		data.put("plotFileName", KmlGenerator.getCsvFileName(csvFile));
		return data;
	}

	
}
