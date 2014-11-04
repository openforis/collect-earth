package org.openforis.collect.earth.sampler.processor;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;

public class OnePointKmlGenerator extends KmlGenerator {

	private final Logger logger = LoggerFactory.getLogger(this.getClass());
	
	public OnePointKmlGenerator(String epsgCode) {
		super(epsgCode);
	}

	@Override
	protected Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints, float distancePlotBoundary) throws KmlGenerationException {
		final Map<String, Object> data = new HashMap<String, Object>();

		// Read CSV file so that we can store the information in a Map that can
		// be used by freemarker to do the "goal-replacement"
		CSVReader reader = null;
		String[] headerRow =null;
		List<SimplePlacemarkObject> placemarks = null;
		int rowNumber =0;
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
				} catch (final Exception e) {
					if(rowNumber > 0 ){
						throw new KmlGenerationException("Error in the CSV " + csvFile + " for row " + Arrays.toString( csvRow ), e);
					}else{
						logger.warn("Errorwhile reading the first line of the CSV fle, probably cause by the column header names");
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
