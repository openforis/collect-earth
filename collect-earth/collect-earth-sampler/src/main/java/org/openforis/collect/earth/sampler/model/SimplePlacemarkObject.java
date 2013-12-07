package org.openforis.collect.earth.sampler.model;

import java.util.List;

import com.vividsolutions.jts.geom.Coordinate;

public class SimplePlacemarkObject {

	private SimpleCoordinate coord;

	private String nextPlacemarkId;

	private String placemarkId;

	private List<SimplePlacemarkObject> points;

	private SimpleRegion region;

	private List<SimpleCoordinate> shape;

	private Integer samplePointOutlined;

	private int elevation;

	private int slope;

	private int aspect;

	private AspectCode aspectHumanReadable;

	public SimplePlacemarkObject(Coordinate coord, String placemarkId, Integer elevation, double slope, double aspect, AspectCode humanReadabaleAspect) {
		super();
		this.placemarkId = placemarkId;
		this.coord = new SimpleCoordinate(coord);
		this.nextPlacemarkId = "unknown";
		this.elevation = elevation;
		this.slope = (int) slope;
		this.aspect = (int) aspect;
		this.aspectHumanReadable = humanReadabaleAspect;
	}

	public SimplePlacemarkObject(double[] coord, String placemarkId) {
		super();
		this.placemarkId = placemarkId;
		this.coord = new SimpleCoordinate(new Coordinate(coord[0], coord[1]));
		this.nextPlacemarkId = "unknown";
	}
	
	public SimplePlacemarkObject(String[] coordinatesLatLong) {
		super();
		this.coord = new SimpleCoordinate(coordinatesLatLong[0], coordinatesLatLong[1]);
		this.nextPlacemarkId = "unknown";
	}

	public int getAspect() {
		return aspect;
	}

	public AspectCode getAspectHumanReadable() {
		return aspectHumanReadable;
	}

	public SimpleCoordinate getCoord() {
		return coord;
	}

	public int getElevation() {
		return elevation;
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

	public void setAspectHumanReadable(AspectCode aspectHumanReadable) {
		this.aspectHumanReadable = aspectHumanReadable;
	}

	public void setCoord(SimpleCoordinate coord) {
		this.coord = coord;
	}

	public void setElevation(int elevation) {
		this.elevation = elevation;
	}

	public void setNextPlacemarkId(String nextPlacemarkId) {
		this.nextPlacemarkId = nextPlacemarkId;
	}

	public void setPlacemarkId(String placemarkId) {
		this.placemarkId = placemarkId;
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

}
