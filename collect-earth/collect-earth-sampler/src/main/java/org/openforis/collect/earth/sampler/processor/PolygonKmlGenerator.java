package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;

public class PolygonKmlGenerator extends AbstractPolygonKmlGenerator{

	
	public PolygonKmlGenerator(String epsgCode, String hostAddress, String localPort) {
		super(epsgCode, hostAddress, localPort, 0, 0, 0,0);

	}


	@Override
	public void fillExternalLine(SimplePlacemarkObject placemark) throws TransformException, KmlGenerationException {
		// No need to do anything, the polygon is already defined within the placemark.kmlPolygon attribute
		// The kmlPolygo is then used directly in the freemarker template
		// Just check that the value is actually set!
		if( StringUtils.isBlank( placemark.getKmlPolygon() ) ){
			throw new KmlGenerationException("The placemark kmlPolygon attribute is empty! There needs to be a column where the <Polygon> value is specified");
		}
		
		placemark.setShape( PolygonKmlGenerator.getPointsInPolygon( placemark.getKmlPolygon() ));
	}

	@Override
	public void fillSamplePoints(SimplePlacemarkObject placemark) throws TransformException {
		placemark.setPoints( new ArrayList<SimplePlacemarkObject>());
	}


	public static List<SimpleCoordinate> getPointsInPolygon(String kmlPolygon) {
		String lowerCase = kmlPolygon.toLowerCase();

		String valueAttr = extractXmlTextValue(lowerCase, "<linearring>","</linearring>");
		valueAttr = extractXmlTextValue(valueAttr,  "<coordinates>","</coordinates>");
		
		// Coordinates look lie this : lat,long,elev lat,long,elev ... -15.805135,16.389028,0.0 -15.804454,16.388447,0.0
		valueAttr = valueAttr.replaceAll( ",0.0 ", ",");
		String[] splitCoord = valueAttr.split(",");
				
		List<SimpleCoordinate> simpleCoordinates = new ArrayList<SimpleCoordinate>();
		for( int idx =0; idx<splitCoord.length-1; idx = idx + 2){
			SimpleCoordinate coords = new SimpleCoordinate( splitCoord[idx+1], splitCoord[idx]);
			simpleCoordinates.add(coords);
		}
		

		return simpleCoordinates;
	}


	public static String extractXmlTextValue(String lowerCase,
			String startLinearRing, String endLinearRing) {
		int startOfLinearRing = lowerCase.indexOf(startLinearRing);
		int endOfLinearRing = lowerCase.indexOf(endLinearRing);
		
		String valueAttr = lowerCase.substring( startOfLinearRing + startLinearRing.length(), endOfLinearRing);
		return valueAttr;
	}

	
}
