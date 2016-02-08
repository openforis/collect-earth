package org.openforis.collect.earth.sampler.model;

import java.util.List;
import java.util.Map;

import com.vividsolutions.jts.geom.Coordinate;

/**
 * Data defining a plot and used in the generation of the KML through a
 * freemarker template.
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
public class SimplePlacemarkObject {

	private SimpleCoordinate coord;

	private String nextPlacemarkId = "unknown";

	private String placemarkId;

	private List<SimplePlacemarkObject> points;

	private SimpleRegion region;

	private List<SimpleCoordinate> shape;

	private Integer samplePointOutlined;

	private int elevation;

	private int slope;

	private int aspect;

	private String[] extraInfo;
	
	private Map<String, String> valuesByColumn;

	private String[] extraColumns;
	
	private String[] idColumns;

	private String kmlPolygon;
	
	public SimplePlacemarkObject(Coordinate coordinate) {
		this.coord = new SimpleCoordinate(coordinate);
	}

	public SimplePlacemarkObject(double[] coord, String placemarkId) {
		super();
		this.placemarkId = placemarkId;
		double longitude = coord[1];
		double latitude = coord[0];
		this.coord = new SimpleCoordinate(new Coordinate(longitude, latitude));
	}

	public SimplePlacemarkObject(String[] coordinatesLatLong) {
		super();
		this.coord = new SimpleCoordinate(coordinatesLatLong[0],
				coordinatesLatLong[1]);
	}

	public SimplePlacemarkObject() {
	}

	public int getAspect() {
		return aspect;
	}



	public SimpleCoordinate getCoord() {
		return coord;
	}

	public int getElevation() {
		return elevation;
	}

	public String[] getExtraInfo() {
		return extraInfo;
	}

	

	public String getNextPlacemarkId() {
		return nextPlacemarkId;
	}

	public String getPlacemarkId() {
		return placemarkId;
	}

	public List<SimplePlacemarkObject> getPoints() {
		return points;
	}

	public SimpleRegion getRegion() {
		return region;
	}

	public Integer getSamplePointOutlined() {
		return samplePointOutlined;
	}

	public List<SimpleCoordinate> getShape() {
		return shape;
	}

	public int getSlope() {
		return slope;
	}

	public void setAspect(double aspect) {
		this.aspect = (int) aspect;
	}

	public void setAspect(int aspect) {
		this.aspect = aspect;
	}


	public void setCoord(SimpleCoordinate coord) {
		this.coord = coord;
	}

	public void setElevation(int elevation) {
		this.elevation = elevation;
	}

	public void setExtraInfo(String[] extraInfo) {
		this.extraInfo = extraInfo;
	}


	public void setNextPlacemarkId(String nextPlacemarkId) {
		this.nextPlacemarkId = nextPlacemarkId;
	}

	public void setPlacemarkId(String placemarkId) {
		this.placemarkId = placemarkId;
	}

	
	public String[] getExtraColumns() {
		return extraColumns;
	}

	public void setExtraColumns(String[] extraColumns) {
		this.extraColumns = extraColumns;
	}


	public void setPoints(List<SimplePlacemarkObject> points) {
		this.points = points;
	}

	public void setRegion(SimpleRegion region) {
		this.region = region;
	}

	public void setSamplePointOutlined(Integer samplePointOutlined) {
		this.samplePointOutlined = samplePointOutlined;
	}

	public void setShape(List<SimpleCoordinate> shape) {
		this.shape = shape;
	}

	public void setSlope(double slope) {
		this.slope = (int) slope;
	}

	public void setSlope(int slope) {
		this.slope = slope;
	}
	
	public Map<String, String> getValuesByColumn() {
		return valuesByColumn;
	}

	public void setValuesByColumn(Map<String, String> valuesByColumn) {
		this.valuesByColumn = valuesByColumn;
	}

	public String[] getIdColumns() {
		return idColumns;
	}

	public void setIdColumns(String[] idColumns) {
		this.idColumns = idColumns;
	}

	public void setKmlPolygon(String kmlPolygon) {
		this.kmlPolygon = kmlPolygon;
		
	}

	public String getKmlPolygon() {
		return kmlPolygon;
	}

}
