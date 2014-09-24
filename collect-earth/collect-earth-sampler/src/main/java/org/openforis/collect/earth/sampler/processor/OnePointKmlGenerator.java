package org.openforis.collect.earth.sampler.processor;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.opengis.referencing.operation.TransformException;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;

public class OnePointKmlGenerator extends KmlGenerator {

	public OnePointKmlGenerator(String epsgCode) {
		super(epsgCode);
	}

	@Override
	protected Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints, float distancePlotBoundary) throws IOException {
		final Map<String, Object> data = new HashMap<String, Object>();

		// Read CSV file so that we can store the information in a Map that can
		// be used by freemarker to do the "goal-replacement"
		CSVReader reader = null;
		String[] headerRow =null;
		List<SimplePlacemarkObject> placemarks = null;
		try {
			reader = getCsvReader(csvFile);
			String[] csvRow;
			placemarks = new ArrayList<SimplePlacemarkObject>();
			while ((csvRow = reader.readNext()) != null) {
				if( headerRow == null ){
					headerRow = csvRow;
				}
				final PlotProperties plotProperties = getPlotProperties(csvRow, headerRow);

				try {
					final Point transformedPoint = transformToWGS84(plotProperties.xCoord, plotProperties.yCoord);
					final SimplePlacemarkObject parentPlacemark = new SimplePlacemarkObject(transformedPoint.getCoordinate(), plotProperties);
					placemarks.add(parentPlacemark);
				} catch (final NumberFormatException e) {
					getLogger().error("Error in the number formatting", e);
				} catch (final Exception e) {
					getLogger().error("Errortransforming to WGS864", e);
				}

			}
		} catch (final Exception e) {
			getLogger().error("Error reading CSV file " + csvFile, e);
		} finally {
			if (reader != null) {
				reader.close();
			}
		}

		data.put("placemarks", placemarks);
		return data;
	}

	@Override
	public void fillExternalLine(float distanceBetweenSamplePoints,
			float distancePlotBoundary, double[] coordOriginalPoints,
			SimplePlacemarkObject parentPlacemark) throws TransformException {
		// TODO Auto-generated method stub
		
	}

	@Override
	public void fillSamplePoints(float distanceBetweenSamplePoints,
			double[] coordOriginalPoints, String currentPlaceMarkId,
			SimplePlacemarkObject parentPlacemark) throws TransformException {
		// TODO Auto-generated method stub
		
	}

}
