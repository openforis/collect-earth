package org.openforis.collect.earth.sampler.processor;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;

public class NfiCirclesKmlGenerator extends PolygonKmlGenerator {
	
	private float distanceBetweenPlots;
	private float radius;


	public NfiCirclesKmlGenerator(String epsgCode, String hostAddress,
			String localPort, Integer innerPointSide, float distanceBetweenSamplePoints, float distanceBetweenPlots) {
		super(epsgCode, hostAddress, localPort);
		this.radius = distanceBetweenSamplePoints;
		super.innerPointSide = innerPointSide;
		this.distanceBetweenPlots = distanceBetweenPlots;
	}
	

	@Override
	public void fillExternalLine(SimplePlacemarkObject placemark) throws TransformException, KmlGenerationException {
		// No need to do anything, the polygon is already defined within the placemark.kmlPolygon attribute
		double[] tractCoord = placemark.getCoord().getCoordinates();
		double[] top = getPointWithOffset(tractCoord, 0, -145);
		double[] bottom = getPointWithOffset(tractCoord, 145, 0);
		placemark.setRegion(new SimpleRegion(top[1] + "", top[0] + "", bottom[1] + "", bottom[0] + ""));

		String kml = getKmlForTract(placemark);
		
		placemark.setKmlPolygon(kml);
		placemark.setMultiShape( PolygonKmlGenerator.getPolygonsInMultiGeometry( kml ) );
	}

	
	private String getKmlForTract(SimplePlacemarkObject placemark) throws TransformException {	
		double[] tractCoord = placemark.getCoord().getCoordinates();
		// Rectangle north-west 
		float halfSide = innerPointSide/2f;
				
		String circleCenter = createRectangle( getPointWithOffset(tractCoord, -radius, -radius), getPointWithOffset(tractCoord, -radius, radius), getPointWithOffset(tractCoord, radius, radius) , getPointWithOffset(tractCoord, radius, -radius) );
		String circleNorth = createRectangle( getPointWithOffset(tractCoord, (radius*3)+distanceBetweenPlots, -radius), getPointWithOffset(tractCoord, (radius*3)+distanceBetweenPlots, radius), getPointWithOffset(tractCoord, radius+distanceBetweenPlots, radius) , getPointWithOffset(tractCoord, radius+distanceBetweenPlots, -radius) );
		String circleEast = createRectangle( getPointWithOffset(tractCoord, -radius, radius+distanceBetweenPlots), getPointWithOffset(tractCoord, -radius, (radius*3)+distanceBetweenPlots), getPointWithOffset(tractCoord, radius, (radius*3)+distanceBetweenPlots) , getPointWithOffset(tractCoord, radius, radius+distanceBetweenPlots) );
		
		String dotCenter = createRectangle( getPointWithOffset(tractCoord, -halfSide, -halfSide), getPointWithOffset(tractCoord, -halfSide, halfSide), getPointWithOffset(tractCoord, halfSide, halfSide) , getPointWithOffset(tractCoord, halfSide, -halfSide) );
		String dotNorth = createRectangle( getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots + halfSide, -halfSide), getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots + halfSide, halfSide), getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots - halfSide, halfSide) , getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots - halfSide, -halfSide) );
		String dotEast = createRectangle( getPointWithOffset(tractCoord, -halfSide, (radius*2)+distanceBetweenPlots - halfSide), getPointWithOffset(tractCoord, -halfSide, (radius*2)+distanceBetweenPlots + halfSide), getPointWithOffset(tractCoord, halfSide, (radius*2)+distanceBetweenPlots + halfSide) , getPointWithOffset(tractCoord, halfSide, (radius*2)+distanceBetweenPlots - halfSide) );
		
		return "<MultiGeometry>" + circleCenter+ "\n" + circleNorth+ "\n" + circleEast+ "\n" + dotCenter+ "\n" + dotNorth+ "\n" + dotEast + "\n"+ "</MultiGeometry>";
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
