package org.openforis.collect.earth.sampler.model;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import org.locationtech.jts.geom.Coordinate;

/**
 * Data defining a plot and used in the generation of the KML through a
 * freemarker template.
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class SimplePlacemarkObject {

	private int aspect;

	private List<SimplePlacemarkObject> buffers;

	private SimpleCoordinate coord;

	private int elevation;

	private String[] extraColumns;

	private String[] extraInfo;

	private String[] idColumns;

	private String kmlPolygon;

	private List<List<SimpleCoordinate>> multiShape;

	private String name;

	private String nextPlacemarkId = "unknown";

	private String originalLatitude;

	private String originalLongitude;

	private String placemarkId;

	private List<SimplePlacemarkObject> points;

	private SimpleRegion region;

	private Integer samplePointOutlined;

	private List<SimpleCoordinate> shape;

	private int slope;

	private List<SimplePlacemarkObject> subplots;

	private Map<String, String> valuesByColumn;

	private String visiblePlacemarkId;

	public SimplePlacemarkObject() {
	}

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
		this.coord = new SimpleCoordinate(coordinatesLatLong[0], coordinatesLatLong[1]);
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		SimplePlacemarkObject other = (SimplePlacemarkObject) obj;
		if (aspect != other.aspect)
			return false;
		if (coord == null) {
			if (other.coord != null)
				return false;
		} else if (!coord.equals(other.coord))
			return false;
		if (elevation != other.elevation)
			return false;
		if (!Arrays.equals(extraColumns, other.extraColumns))
			return false;
		if (!Arrays.equals(extraInfo, other.extraInfo))
			return false;
		if (!Arrays.equals(idColumns, other.idColumns))
			return false;
		if (nextPlacemarkId == null) {
			if (other.nextPlacemarkId != null)
				return false;
		} else if (!nextPlacemarkId.equals(other.nextPlacemarkId))
			return false;
		if (placemarkId == null) {
			if (other.placemarkId != null)
				return false;
		} else if (!placemarkId.equals(other.placemarkId))
			return false;

		if (valuesByColumn == null) {
			if (other.valuesByColumn != null)
				return false;
		} else if (!valuesByColumn.equals(other.valuesByColumn))
			return false;
		return true;
	}

	public int getAspect() {
		return aspect;
	}

	public List<SimplePlacemarkObject> getBuffers() {
		return buffers;
	}

	public SimpleCoordinate getCoord() {
		return coord;
	}

	public int getElevation() {
		return elevation;
	}

	public String[] getExtraColumns() {
		return extraColumns;
	}

	public String[] getExtraInfo() {
		return extraInfo;
	}

	public String[] getIdColumns() {
		return idColumns;
	}

	public String getKmlPolygon() {
		return kmlPolygon;
	}

	public List<List<SimpleCoordinate>> getMultiShape() {
		return multiShape;
	}

	public String getName() {
		return name;
	}

	public String getNextPlacemarkId() {
		return nextPlacemarkId;
	}

	public String getOriginalLatitude() {
		return originalLatitude;
	}

	public String getOriginalLongitude() {
		return originalLongitude;
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

	public List<SimplePlacemarkObject> getSubplots() {
		return subplots;
	}

	public Map<String, String> getValuesByColumn() {
		return valuesByColumn;
	}

	public String getVisiblePlacemarkId() {
		return visiblePlacemarkId;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + aspect;
		result = prime * result + ((coord == null) ? 0 : coord.hashCode());
		result = prime * result + elevation;
		result = prime * result + Arrays.hashCode(extraColumns);
		result = prime * result + Arrays.hashCode(extraInfo);
		result = prime * result + Arrays.hashCode(idColumns);
		result = prime * result + ((nextPlacemarkId == null) ? 0 : nextPlacemarkId.hashCode());
		result = prime * result + ((placemarkId == null) ? 0 : placemarkId.hashCode());
		result = prime * result + ((points == null) ? 0 : points.hashCode());
		result = prime * result + ((region == null) ? 0 : region.hashCode());
		result = prime * result + ((samplePointOutlined == null) ? 0 : samplePointOutlined.hashCode());
		result = prime * result + ((shape == null) ? 0 : shape.hashCode());
		result = prime * result + slope;
		result = prime * result + ((valuesByColumn == null) ? 0 : valuesByColumn.hashCode());
		return result;
	}

	public void setAspect(double aspect) {
		this.aspect = (int) aspect;
	}

	public void setAspect(int aspect) {
		this.aspect = aspect;
	}

	public void setBuffers(List<SimplePlacemarkObject> buffers) {
		this.buffers = buffers;
	}

	public void setCoord(SimpleCoordinate coord) {
		this.coord = coord;
	}

	public void setElevation(int elevation) {
		this.elevation = elevation;
	}

	public void setExtraColumns(String[] extraColumns) {
		this.extraColumns = extraColumns;
	}

	public void setExtraInfo(String[] extraInfo) {
		this.extraInfo = extraInfo;
	}

	public void setIdColumns(String[] idColumns) {
		this.idColumns = idColumns;
	}

	public void setKmlPolygon(String kmlPolygon) {
		this.kmlPolygon = kmlPolygon;
	}

	public void setMultiShape(List<List<SimpleCoordinate>> multiShape) {
		this.multiShape = multiShape;
		if (multiShape != null && !multiShape.isEmpty()) {
			shape = multiShape.get(0);
		}
	}

	public void setName(String name) {
		this.name = name;
	}

	public void setNextPlacemarkId(String nextPlacemarkId) {
		this.nextPlacemarkId = nextPlacemarkId;
	}

	public void setOriginalLatitude(String originalLatitude) {
		this.originalLatitude = originalLatitude;
	}

	public void setOriginalLongitude(String originalLongitude) {
		this.originalLongitude = originalLongitude;
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

	public void setShape(List<SimpleCoordinate> shapePoints) {
		if (shapePoints != null) {
			List<List<SimpleCoordinate>> tempShapes = new ArrayList<>();
			tempShapes.add(shapePoints);
			multiShape = tempShapes;
		}
		shape = shapePoints;
	}

	public void setSlope(double slope) {
		this.slope = (int) slope;
	}

	public void setSlope(int slope) {
		this.slope = slope;
	}

	public void setSubplots(List<SimplePlacemarkObject> subplots) {
		this.subplots = subplots;
	}

	public void setValuesByColumn(Map<String, String> valuesByColumn) {
		this.valuesByColumn = valuesByColumn;
	}

	public void setVisiblePlacemarkId(String visiblePlacemarkId) {
		this.visiblePlacemarkId = visiblePlacemarkId;
	}

	@Override
	public String toString() {
		return "SimplePlacemarkObject [coord=" + coord + ", nextPlacemarkId=" + nextPlacemarkId + ", placemarkId="
				+ placemarkId + ", points=" + points + ", region=" + region + ", shape=" + shape
				+ ", samplePointOutlined=" + samplePointOutlined + ", elevation=" + elevation + ", slope=" + slope
				+ ", aspect=" + aspect + ", extraInfo=" + Arrays.toString(extraInfo) + ", valuesByColumn="
				+ valuesByColumn + ", extraColumns=" + Arrays.toString(extraColumns) + ", idColumns="
				+ Arrays.toString(idColumns) + ", originalLatitude=" + originalLatitude + ", originalLongitude="
				+ originalLongitude + ", kmlPolygon=" + kmlPolygon + "]";
	}

}
