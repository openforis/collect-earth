package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.sampler.model.SimpleCoordinate;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;
import org.slf4j.LoggerFactory;

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
		
		if( StringUtils.isBlank( kmlPolygon)){
			throw new IllegalArgumentException("The KML Polygon string cannot be null");
		}
		String lowerCase = kmlPolygon.toLowerCase();
		
		String valueAttr = extractXmlTextValue(lowerCase, "<linearring>","</linearring>");
		valueAttr = extractXmlTextValue(valueAttr,  "<coordinates>","</coordinates>");
		
		// Coordinates look like this : lat,long,elev lat,long,elev ... -15.805135,16.389028,0.0 -15.804454,16.388447,0.0
	
		String[] splitGroup =   valueAttr.split(" ");
		List<SimpleCoordinate> simpleCoordinates = new ArrayList<SimpleCoordinate>();
		for (String coordsWithElev : splitGroup) {
			String[] splitCoord = coordsWithElev.split(",");
			if( splitCoord.length > 1 ){
				SimpleCoordinate coords = new SimpleCoordinate( splitCoord[1], splitCoord[0]);
				simpleCoordinates.add(coords);
			}
		}

		return simpleCoordinates;
	}


	public static String extractXmlTextValue(String lowerCase,
			String startXmlTag, String endXmlTag) {
		int startOfXmlTag = lowerCase.indexOf(startXmlTag);
		int endOfXmlTag = lowerCase.indexOf(endXmlTag);
		String valueAttr = "";
		try {
			if( startOfXmlTag!= -1 && endOfXmlTag != -1 ){
					valueAttr = lowerCase.substring( startOfXmlTag + startXmlTag.length(), endOfXmlTag);
					
			}
		} catch (Exception e) {
			System.out.println( lowerCase );
			System.out.println( startXmlTag );
			System.out.println( endXmlTag );
			// TODO Auto-generated catch block
			e.printStackTrace();
			LoggerFactory.getLogger( PolygonKmlGenerator.class).error( " error with " + lowerCase, e );
		}
		return valueAttr;
	}

	
}
