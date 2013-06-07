package org.openforis.eye.generator.model;

import java.util.List;

import com.vividsolutions.jts.geom.Coordinate;

public class SimplePlacemarkObject {

	protected SimpleCoordinate coord;

	protected String nextPlacemarkId;

	protected String placemarkId;

	protected List<SimplePlacemarkObject> points;

	protected SimpleRegion region;

	protected List<SimpleCoordinate> shape;

	public SimplePlacemarkObject(Coordinate coord, String placemarkId) {
		super();
		this.placemarkId = placemarkId;
		this.coord = new SimpleCoordinate(coord);
		this.nextPlacemarkId = "unknown";
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

}
