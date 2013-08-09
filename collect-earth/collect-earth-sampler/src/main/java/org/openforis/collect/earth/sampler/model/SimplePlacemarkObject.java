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

	private double slopeNorthSouth;

	private double slopeWestEast;

	private String orientation;

	public int getElevation() {
		return elevation;
	}

	public void setElevation(int elevation) {
		this.elevation = elevation;
	}

	public SimplePlacemarkObject(Coordinate coord, String placemarkId, Integer elevation, double slopeNorthSouth,
			double slopeWestEast, String orientation) {
		super();
		this.placemarkId = placemarkId;
		this.coord = new SimpleCoordinate(coord);
		this.nextPlacemarkId = "unknown";
		this.elevation = elevation;
		this.slopeNorthSouth = slopeNorthSouth;
		this.slopeWestEast = slopeWestEast;
		this.orientation = orientation;
	}

	public SimplePlacemarkObject(double[] coord, String placemarkId) {
		super();
		this.placemarkId = placemarkId;
		this.coord = new SimpleCoordinate(new Coordinate(coord[0], coord[1]));
		this.nextPlacemarkId = "unknown";
	}

	public SimpleCoordinate getCoord() {
		return coord;
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

	public List<SimpleCoordinate> getShape() {
		return shape;
	}

	public void setCoord(SimpleCoordinate coord) {
		this.coord = coord;
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

	public void setShape(List<SimpleCoordinate> shape) {
		this.shape = shape;
	}

	public Integer getSamplePointOutlined() {
		return samplePointOutlined;
	}

	public void setSamplePointOutlined(Integer samplePointOutlined) {
		this.samplePointOutlined = samplePointOutlined;
	}

	public double getSlopeNorthSouth() {
		return slopeNorthSouth;
	}

	public void setSlopeNorthSouth(double slopeNorthSouth) {
		this.slopeNorthSouth = slopeNorthSouth;
	}

	public double getSlopeWestEast() {
		return slopeWestEast;
	}

	public void setSlopeWestEast(double slopeWestEast) {
		this.slopeWestEast = slopeWestEast;
	}

	public String getOrientation() {
		return orientation;
	}

	public void setOrientation(String orientation) {
		this.orientation = orientation;
	}

}
