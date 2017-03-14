package org.openforis.collect.earth.sampler.processor;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;

public class NfmaKmlGenerator extends PolygonKmlGenerator {
	static final int DIST_TRACT_CORNER_LAT = 500;
	static final int DIST_TRACT_CORNER_LONG = 500;
	
	public NfmaKmlGenerator(String epsgCode, String hostAddress,
			String localPort) {
		super(epsgCode, hostAddress, localPort);
	}
	

	@Override
	public void fillExternalLine(SimplePlacemarkObject placemark) throws TransformException, KmlGenerationException {
		// No need to do anything, the polygon is already defined within the placemark.kmlPolygon attribute
		double[] tractCoord = placemark.getCoord().getCoordinates();
		double[] top = getPointWithOffset(tractCoord, 0, -1000);
		double[] bottom = getPointWithOffset(tractCoord, 1000, 0);
		placemark.setRegion(new SimpleRegion(top[1] + "", top[0] + "", bottom[1] + "", bottom[0] + ""));

		String kml = getKmlForTract(placemark);
		
		placemark.setKmlPolygon(kml);
		placemark.setMultiShape( PolygonKmlGenerator.getPointsInPolygon( kml ) );
	}

	
	private String getKmlForTract(SimplePlacemarkObject placemark) throws TransformException {	
		double[] tractCoord = placemark.getCoord().getCoordinates();
		// Rectangle north-west 
		String polygonNorthWest = createRectangle( getPointWithOffsetAndMove(tractCoord, -250 , 260), getPointWithOffsetAndMove(tractCoord, -100, 260), getPointWithOffsetAndMove(tractCoord, -100, 240) , getPointWithOffsetAndMove(tractCoord, -250, 240) );
		String polygonNorthEast = createRectangle( getPointWithOffsetAndMove(tractCoord, 260, 250), getPointWithOffsetAndMove(tractCoord, 260, 100), getPointWithOffsetAndMove(tractCoord, 240, 100) , getPointWithOffsetAndMove(tractCoord, 240, 250) );
		String polygonSouthWest = createRectangle( getPointWithOffsetAndMove(tractCoord, 250, -240), getPointWithOffsetAndMove(tractCoord, 250, -260), getPointWithOffsetAndMove(tractCoord, 100, -260) , getPointWithOffsetAndMove(tractCoord, 100, -240) );
		String polygonSouthEast = createRectangle( getPointWithOffsetAndMove(tractCoord, -260, -250), getPointWithOffsetAndMove(tractCoord, -260, -100), getPointWithOffsetAndMove(tractCoord, -240, -100) , getPointWithOffsetAndMove(tractCoord, -240, -250) );
		String tractCorner = createRectangle( getPointWithOffset(tractCoord, -2, -2), getPointWithOffset(tractCoord, -2, 2), getPointWithOffset(tractCoord, 2, 2) , getPointWithOffset(tractCoord, 2, -2) );
		
		return "<MultiGeometry>" + polygonNorthEast+ "\n" + polygonNorthWest+ "\n" + polygonSouthEast+ "\n" + polygonSouthWest+ "\n" + tractCorner+ "\n"+ "</MultiGeometry>";
	}

	private double[] getPointWithOffsetAndMove(double[] tractCoord, int offsetLat, int offsetLong) throws TransformException {
		return getPointWithOffset(tractCoord,  offsetLat + DIST_TRACT_CORNER_LAT, offsetLong + DIST_TRACT_CORNER_LONG);
	}



	private String createRectangle(double[] point1, double[] point2, double[] point3, double[] point4) {
		int longitude = 0;
		int latitude = 1;
		String polygon = "<Polygon><outerBoundaryIs><LinearRing><coordinates>";
		
		polygon += point1[latitude] + "," + point1[longitude] + ",0\n"  ;
		polygon += point2[latitude] + "," + point2[longitude] + ",0\n"  ;
		polygon += point3[latitude] + "," + point3[longitude] + ",0\n"  ;
		polygon += point4[latitude] + "," + point4[longitude] + ",0\n"  ;
		polygon += point1[latitude] + "," + point1[longitude] + ",0\n"  ;
		
		polygon += "</coordinates></LinearRing></outerBoundaryIs></Polygon>";
		return polygon;
	}

}
