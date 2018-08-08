package org.openforis.collect.earth.sampler.processor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.openforis.collect.earth.sampler.model.SimplePlacemarkObject;
import org.openforis.collect.earth.sampler.model.SimpleRegion;
import org.openforis.collect.earth.sampler.utils.KmlGenerationException;
import org.opengis.referencing.operation.TransformException;

public class NfmaKmlGenerator extends PolygonKmlGenerator {
	static final int DIST_TRACT_CORNER_LAT = 500;
	static final int DIST_TRACT_CORNER_LONG = 500;
	
	private static final int DEFAULT_SU_WIDTH = 1000;
	private static final int DEFAULT_CORNER_WIDTH = 4;
	private static final int DEFAULT_DISTANCE_FROM_SU_BORDER = 250;
	private static final int DEFAULT_PLOT_LENGTH = 250;
	private static final int DEFAULT_PLOT_WIDTH = 20;
	private static final boolean DEFAULT_DRAW_CORNER = true;
	private static final boolean DEFAULT_DRAW_LINES = false;

	private final int distanceFromSUBorder = DEFAULT_DISTANCE_FROM_SU_BORDER;
	private final int plotWidth = DEFAULT_PLOT_WIDTH;
	private final boolean drawCorner = DEFAULT_DRAW_CORNER;
	private final int plotLength;
	private final boolean drawLines;

	public NfmaKmlGenerator(String epsgCode, String hostAddress,
			String localPort) {
		this(epsgCode, hostAddress, localPort, DEFAULT_PLOT_LENGTH, DEFAULT_DRAW_LINES);
	}
	
	public NfmaKmlGenerator(String epsgCode, String hostAddress,
			String localPort, int plotLength, boolean drawLines) {
		super(epsgCode, hostAddress, localPort);
		this.plotLength = plotLength;
		this.drawLines = drawLines;
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
		placemark.setMultiShape( PolygonKmlGenerator.getPolygonsInMultiGeometry( kml ) );
	}

	
	private String getKmlForTract(SimplePlacemarkObject placemark) throws TransformException {	
		double[] tractCoord = placemark.getCoord().getCoordinates();
		int cornerWidth = DEFAULT_CORNER_WIDTH;
		int suWidth = DEFAULT_SU_WIDTH;
		
		int halfSUWidth = Math.floorDiv(suWidth, 2);
		int centerToPlotSPDistance = halfSUWidth - distanceFromSUBorder; //distance between su center and plot starting point
		int halfPlotWidth = Math.floorDiv(plotWidth, 2);
		int halfCornerWidth = Math.floorDiv(cornerWidth, 2);
		
		String polygonNorthWest = createRectangle( 
			getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance, centerToPlotSPDistance + halfPlotWidth), 
			getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance + plotLength, centerToPlotSPDistance + halfPlotWidth), 
			getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance + plotLength, centerToPlotSPDistance - halfPlotWidth) , 
			getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance, centerToPlotSPDistance - halfPlotWidth) 
		);
		String polygonNorthEast = createRectangle( 
			getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance - halfPlotWidth, centerToPlotSPDistance), 
			getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance + halfPlotWidth, centerToPlotSPDistance), 
			getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance + halfPlotWidth, centerToPlotSPDistance - plotLength), 
			getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance - halfPlotWidth, centerToPlotSPDistance - plotLength) 
		);
		String polygonSouthEast = createRectangle( 
			getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance, -centerToPlotSPDistance - halfPlotWidth), 
			getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance, -centerToPlotSPDistance + halfPlotWidth), 
			getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance - plotLength, -centerToPlotSPDistance + halfPlotWidth), 
			getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance - plotLength, -centerToPlotSPDistance - halfPlotWidth) 
		);
		String polygonSouthWest = createRectangle( 
			getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance - halfPlotWidth, -centerToPlotSPDistance), 
			getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance - halfPlotWidth, -centerToPlotSPDistance + plotLength), 
			getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance + halfPlotWidth, -centerToPlotSPDistance + plotLength) , 
			getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance + halfPlotWidth, -centerToPlotSPDistance) 
		);
		String tractCorner = createRectangle( 
			getPointWithOffset(tractCoord, -halfCornerWidth, -halfCornerWidth), 
			getPointWithOffset(tractCoord, -halfCornerWidth, halfCornerWidth), 
			getPointWithOffset(tractCoord, halfCornerWidth, halfCornerWidth) , 
			getPointWithOffset(tractCoord, halfCornerWidth, -halfCornerWidth) );
		
		List<String> geometryParts = new ArrayList<String>(Arrays.asList(polygonNorthEast, polygonNorthWest, polygonSouthEast, polygonSouthWest));
		
		if (drawCorner) {
			geometryParts.add(tractCorner);
		}
		
		if (drawLines) {
			int plotAreasCount = 10; //divide plots in 10 areas
			int linesDistance = Math.floorDiv(plotLength, plotAreasCount);
			int lineMargin = 2; //margin from plot border
			
			List<String> polygonNWlines = new ArrayList<String>(plotAreasCount - 1);
			for (int i = 1; i < plotAreasCount; i++) {
				double[] point1 = getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance + linesDistance * i, centerToPlotSPDistance + halfPlotWidth - lineMargin);
				double[] point2 = getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance + linesDistance * i, centerToPlotSPDistance - halfPlotWidth + lineMargin);
				polygonNWlines.add(createLine(point1, point2));
			}
			
			List<String> polygonNElines = new ArrayList<String>(plotAreasCount - 1);
			for (int i = 1; i < plotAreasCount; i++) {
				double[] point1 = getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance - halfPlotWidth + lineMargin, centerToPlotSPDistance - linesDistance * i);
				double[] point2 = getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance + halfPlotWidth - lineMargin, centerToPlotSPDistance - linesDistance * i);
				polygonNElines.add(createLine(point1, point2));
			}
			List<String> polygonSElines = new ArrayList<String>(plotAreasCount - 1);
			for (int i = 1; i < plotAreasCount; i++) {
				double[] point1 = getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance - linesDistance * i, -centerToPlotSPDistance - halfPlotWidth + lineMargin);
				double[] point2 = getPointWithOffsetAndMove(tractCoord, centerToPlotSPDistance - linesDistance * i, -centerToPlotSPDistance + halfPlotWidth - lineMargin);
				polygonSElines.add(createLine(point1, point2));
			}
			List<String> polygonSWlines = new ArrayList<String>(plotAreasCount - 1);
			for (int i = 1; i < plotAreasCount; i++) {
				double[] point1 = getPointWithOffsetAndMove(tractCoord, -centerToPlotSPDistance - halfPlotWidth + lineMargin, -centerToPlotSPDistance + linesDistance * i);
				double[] point2 = getPointWithOffsetAndMove(tractCoord,-centerToPlotSPDistance + halfPlotWidth - lineMargin, -centerToPlotSPDistance + linesDistance * i);
				polygonSWlines.add(createLine(point1, point2));
			}
			geometryParts.addAll(polygonNWlines);
			geometryParts.addAll(polygonNElines);
			geometryParts.addAll(polygonSElines);
			geometryParts.addAll(polygonSWlines);
		}
		
		return "<MultiGeometry>" + StringUtils.join(geometryParts, '\n') + "</MultiGeometry>";
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

	private String createLine(double[] point1, double[] point2) {
		int lon = 0;
		int lat = 1;
		return "<LineString><coordinates>" + StringUtils.join(new double[] { 
				point1[lat], point1[lon], 0., 
				point2[lat], point2[lon], 0. 
			}, ',')
			+ "</coordinates></LineString>";
	}

}
