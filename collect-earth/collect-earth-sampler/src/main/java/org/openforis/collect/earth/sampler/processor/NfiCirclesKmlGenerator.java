package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;

import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;

public abstract class NfiCirclesKmlGenerator extends PolygonKmlGenerator {

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
		placemark.setRegion(new SimpleRegion( Double.toString( top[1]), Double.toString(top[0] ), Double.toString( bottom[1] ), Double.toString( bottom[0] ) ));

		String kml = getKmlForTract(placemark);

		placemark.setPolygon(kml);
		placemark.setMultiShape( getPolygonsInMultiGeometry( kml ) );
	}


	protected abstract String getKmlForTract(SimplePlacemarkObject placemark) throws TransformException;


	protected String getKmlForTract(SimplePlacemarkObject placemark, boolean fourCircles) throws TransformException {
		double[] tractCoord = placemark.getCoord().getCoordinates();
		// Rectangle north-west
		float halfSide = innerPointSide/2f;

		ArrayList<SimplePlacemarkObject> subplots = new ArrayList<>();




		String circleCenter = createRectangle( getPointWithOffset(tractCoord, -radius, -radius), getPointWithOffset(tractCoord, -radius, radius), getPointWithOffset(tractCoord, radius, radius) , getPointWithOffset(tractCoord, radius, -radius) );
		String circleNorth = createRectangle( getPointWithOffset(tractCoord, (radius*3)+distanceBetweenPlots, -radius), getPointWithOffset(tractCoord, (radius*3)+distanceBetweenPlots, radius), getPointWithOffset(tractCoord, radius+distanceBetweenPlots, radius) , getPointWithOffset(tractCoord, radius+distanceBetweenPlots, -radius) );
		String circleEast = createRectangle( getPointWithOffset(tractCoord, -radius, radius+distanceBetweenPlots), getPointWithOffset(tractCoord, -radius, (radius*3)+distanceBetweenPlots), getPointWithOffset(tractCoord, radius, (radius*3)+distanceBetweenPlots) , getPointWithOffset(tractCoord, radius, radius+distanceBetweenPlots) );

		String dotCenter = createRectangle( getPointWithOffset(tractCoord, -halfSide, -halfSide), getPointWithOffset(tractCoord, -halfSide, halfSide), getPointWithOffset(tractCoord, halfSide, halfSide) , getPointWithOffset(tractCoord, halfSide, -halfSide) );
		String dotNorth = createRectangle( getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots + halfSide, -halfSide), getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots + halfSide, halfSide), getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots - halfSide, halfSide) , getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots - halfSide, -halfSide) );
		String dotEast = createRectangle( getPointWithOffset(tractCoord, -halfSide, (radius*2)+distanceBetweenPlots - halfSide), getPointWithOffset(tractCoord, -halfSide, (radius*2)+distanceBetweenPlots + halfSide), getPointWithOffset(tractCoord, halfSide, (radius*2)+distanceBetweenPlots + halfSide) , getPointWithOffset(tractCoord, halfSide, (radius*2)+distanceBetweenPlots - halfSide) );

		final SimplePlacemarkObject southEastPlot = new SimplePlacemarkObject( getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots, 0) , placemark.getPlacemarkId() + "southEastPlot");
		southEastPlot.setShape(getSamplePointPolygon(getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots - radius, -radius), (int) (radius*2)));
		southEastPlot.setName("South East");
		subplots.add( southEastPlot );

		final SimplePlacemarkObject northWestPlot = new SimplePlacemarkObject( getPointWithOffset(tractCoord, 0, (radius*2)+distanceBetweenPlots) , placemark.getPlacemarkId() + "northWestPlot");
		northWestPlot.setShape(getSamplePointPolygon(getPointWithOffset(tractCoord, -radius , radius+distanceBetweenPlots ), (int) (radius*2)));
		northWestPlot.setName("North West");
		subplots.add( northWestPlot );


		if( fourCircles ) {
			String dotNorthEast = createRectangle(
					getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots + halfSide, (radius*2)+distanceBetweenPlots - halfSide),
					getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots + halfSide, (radius*2)+distanceBetweenPlots + halfSide),
					getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots - halfSide, (radius*2)+distanceBetweenPlots + halfSide) ,
					getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots - halfSide, (radius*2)+distanceBetweenPlots - halfSide) );
			String circleNorthEast = createRectangle( getPointWithOffset(tractCoord, (radius*3)+distanceBetweenPlots, radius+distanceBetweenPlots), getPointWithOffset(tractCoord, (radius*3)+distanceBetweenPlots, (radius*3)+distanceBetweenPlots), getPointWithOffset(tractCoord, radius+distanceBetweenPlots ,(radius*3)+distanceBetweenPlots),getPointWithOffset(tractCoord, radius+distanceBetweenPlots, radius+distanceBetweenPlots) );



			final SimplePlacemarkObject northEastPlot = new SimplePlacemarkObject( getPointWithOffset(tractCoord, (radius*2)+distanceBetweenPlots, (radius*2)+distanceBetweenPlots) , placemark.getPlacemarkId() + "northEastPlot");
			northEastPlot.setShape(getSamplePointPolygon(getPointWithOffset(tractCoord, radius+distanceBetweenPlots, radius+distanceBetweenPlots ), (int) (radius*2)) );
			northEastPlot.setName("North East");
			subplots.add( northEastPlot );


			placemark.setSubplots( subplots );
			return "<MultiGeometry>" + circleCenter+ "\n" + circleNorth+ "\n" + circleEast+ "\n" + circleNorthEast+ "\n" + dotCenter+ "\n" + dotNorth+ "\n" + dotEast + "\n"+ dotNorthEast + "\n"+ "</MultiGeometry>";
		}else {

			placemark.setSubplots( subplots );
			return "<MultiGeometry>" + circleCenter+ "\n" + circleNorth+ "\n" + circleEast+ "\n" + dotCenter+ "\n" + dotNorth+ "\n" + dotEast + "\n"+ "</MultiGeometry>";
		}
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
