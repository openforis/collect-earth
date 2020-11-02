package org.openforis.collect.earth.sampler.processor;

import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.io.ParseException;
import org.locationtech.jts.io.WKTReader;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class PolygonWktGenerator extends PolygonGeometryGenerator {
	public PolygonWktGenerator(String epsgCode, String hostAddress, String localPort) {
		super(epsgCode, hostAddress, localPort , 0, 0, 0d,0d,0, null);
	}

	protected final Logger logger = LoggerFactory.getLogger(PolygonWktGenerator.class);
	private static WKTReader reader = new WKTReader();

	public String isWktPolygonColumnFound(String[] csvValues) {
		for (int i = 0; i < csvValues.length; i++) {
			String value = csvValues[i];

			try {
				reader.read(value);
				setColumnWithPolygonString( i );
				return value;
			} catch (ParseException e) {

			}
		}
		return null;
	}

	@Override
	protected void processPolygonProperties(SimplePlacemarkObject plotProperties, String[] csvValuesInLine) {
		String polygon = isWktPolygonColumnFound(csvValuesInLine);
		if( polygon != null) {
			processWktPolygonProperties(plotProperties, polygon);
		}
	}

	@Override
	protected Geometry getGeometry(String polygon) {
		Geometry geometry = null;
		try {
			geometry = reader.read(polygon);
		} catch (ParseException e) {
			logger.error("WKT text is nor parseable", e);
		}
		return geometry;
	}

}
