package org.openforis.collect.earth.sampler.processor;

import org.locationtech.jts.geom.Geometry;
import org.wololo.jts2geojson.GeoJSONReader;

public class PolygonGeojsonGenerator extends PolygonGeometryGenerator {

	public PolygonGeojsonGenerator(String epsgCode, String hostAddress, String localPort ) {
		super(epsgCode, hostAddress, localPort , 0, 0, 0d,0d,0, null);
		// TODO Auto-generated constructor stub
	}

	protected Geometry getGeometry(String polygon) {
		GeoJSONReader reader = new GeoJSONReader();
		return reader.read(polygon);
	}
}