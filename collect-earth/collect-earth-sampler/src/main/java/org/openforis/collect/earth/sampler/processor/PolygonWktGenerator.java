package org.openforis.collect.earth.sampler.processor;

import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.io.ParseException;
import org.locationtech.jts.io.WKTReader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class PolygonWktGenerator extends PolygonGeometryGenerator {
	public PolygonWktGenerator(String epsgCode, String hostAddress, String localPort) {
		super(epsgCode, hostAddress, localPort , 0, 0, 0d,0d,0, null);
	}

	protected final Logger logger = LoggerFactory.getLogger(PolygonWktGenerator.class);

	@Override
	protected Geometry getGeometry(String polygon) {
		WKTReader reader = new WKTReader();
		Geometry geometry = null;
		try {
			geometry = reader.read(polygon);
		} catch (ParseException e) {
			logger.error("WKT text is nor parseable", e);
		}
		return geometry;
	}

}
