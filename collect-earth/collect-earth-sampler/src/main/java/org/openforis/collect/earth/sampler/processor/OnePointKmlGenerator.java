package org.openforis.collect.earth.sampler.processor;

import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.IOException;
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
	protected Map<String, Object> getTemplateData(String csvFile, float distanceBetweenSamplePoints)
			throws FileNotFoundException,
			IOException {
		Map<String, Object> data = new HashMap<String, Object>();

		// Read CSV file so that we can store the information in a Map that can
		// be used by freemarker to do the "goal-replacement"
		CSVReader reader = new CSVReader(new FileReader(csvFile), ' ');
		String[] nextRow;
		List<SimplePlacemarkObject> placemarks = new ArrayList<SimplePlacemarkObject>();
		while ((nextRow = reader.readNext()) != null) {
			// nextLine[] is an array of values from the line
			try {
				Point transformedPoint = transformToWGS84(Double.parseDouble(nextRow[1]), Double.parseDouble(nextRow[2]));
				placemarks.add(new SimplePlacemarkObject(transformedPoint.getCoordinate(), "ge_" + nextRow[0]));
			} catch (NumberFormatException e) {
				getLogger().error("Error in the number formatting", e);
			} catch (Exception e) {
				getLogger().error("Errortransforming to WGS864", e);
			}

		}
		reader.close();
		data.put("placemarks", placemarks);
		return data;
	}

}
