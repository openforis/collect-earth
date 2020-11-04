package org.openforis.collect.earth.sampler.processor;

import java.util.List;

import org.apache.commons.lang.StringUtils;
import org.locationtech.jts.geom.Geometry;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.wololo.jts2geojson.GeoJSONReader;

public class PolygonGeojsonGenerator extends PolygonGeometryGenerator {

	public PolygonGeojsonGenerator(String epsgCode, String hostAddress, String localPort ) {
		super(epsgCode, hostAddress, localPort , 0, 0, 0d,0d,0, null);
	}

	@Override
	protected void processPolygonProperties(SimplePlacemarkObject plotProperties, String[] csvValuesInLine) {
		String polygon = isGeoJsonPolygonColumnFound(csvValuesInLine);
		processGeoJsonPolygonProperties(plotProperties, ((String) polygon));
	}

	public void processGeoJsonPolygonProperties(SimplePlacemarkObject plotProperties, String geoJsonPolygon) {
		List<List<SimpleCoordinate>> pointsInPolygon = getPolygonsInMultiGeometry(geoJsonPolygon);
		fillPolygonProperties(plotProperties, geoJsonPolygon, pointsInPolygon);
	}

	public String isGeoJsonPolygonColumnFound(String[] csvValues) {
		for (int i = 0; i < csvValues.length; i++) {
			String value = csvValues[i];
			if(StringUtils.isNotBlank( value )) {
				try {
					GeoJSONReader reader = new GeoJSONReader();
					reader.read(value);
					setColumnWithPolygonString( i );
					return value;
				} catch (Exception e) {
					// DO NOTHING, IT IS NOT A WKT
				}
			}
		}
		return null;
	}

	protected Geometry getGeometry(String polygon) {
		GeoJSONReader reader = new GeoJSONReader();
		return reader.read(polygon);
	}


}