package org.openforis.collect.earth.sampler.processor;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;

import au.com.bytecode.opencsv.CSVReader;

import com.vividsolutions.jts.geom.Point;


public class OnePointKmlGenerator extends KmlGenerator{

	public OnePointKmlGenerator(String epsgCode) {
		super(epsgCode);
	}

	@Override
	protected Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints, float distancePlotBoundary)
			throws IOException {
		Map<String, Object> data = new HashMap<String, Object>();

		// Read CSV file so that we can store the information in a Map that can
		// be used by freemarker to do the "goal-replacement"
		CSVReader reader = null;
		List<SimplePlacemarkObject> placemarks = null;
		try {
			reader = getCsvReader(csvFile);
			String[] csvRow;
			placemarks = new ArrayList<SimplePlacemarkObject>();
			while ((csvRow = reader.readNext()) != null) {
				PlotProperties plotProperties = getPlotProperties(csvRow);

				try {
					Point transformedPoint = transformToWGS84(plotProperties.xCoord, plotProperties.yCoord);
					SimplePlacemarkObject parentPlacemark = new SimplePlacemarkObject(transformedPoint.getCoordinate(), "ge_"
							+ plotProperties.id, plotProperties.elevation, plotProperties.slope, plotProperties.aspect, getHumanReadableAspect(plotProperties.aspect));
					placemarks.add(parentPlacemark);
				} catch (NumberFormatException e) {
					getLogger().error("Error in the number formatting", e);
				} catch (Exception e) {
					getLogger().error("Errortransforming to WGS864", e);
				}

			}
		} catch (Exception e) {
			getLogger().error("Error reading CSV file " + csvFile, e);
		} finally {
			if (reader != null) {
				reader.close();
			}
		}

		data.put("placemarks", placemarks);
		return data;
	}

}
