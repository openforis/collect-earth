package org.openforis.collect.earth.sampler.model;

import java.util.Arrays;
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
	
	private String visiblePlacemarkId;

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

	private String originalLatitude;
	
	private String originalLongitude;
	
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
		result = prime * result
				+ ((nextPlacemarkId == null) ? 0 : nextPlacemarkId.hashCode());
		result = prime * result
				+ ((placemarkId == null) ? 0 : placemarkId.hashCode());
		result = prime * result + ((points == null) ? 0 : points.hashCode());
		result = prime * result + ((region == null) ? 0 : region.hashCode());
		result = prime
				* result
				+ ((samplePointOutlined == null) ? 0 : samplePointOutlined
						.hashCode());
		result = prime * result + ((shape == null) ? 0 : shape.hashCode());
		result = prime * result + slope;
		result = prime * result
				+ ((valuesByColumn == null) ? 0 : valuesByColumn.hashCode());
		return result;
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

	public String getOriginalLatitude() {
		return originalLatitude;
	}

	public void setOriginalLatitude(String originalLatitude) {
		this.originalLatitude = originalLatitude;
	}

	public String getOriginalLongitude() {
		return originalLongitude;
	}

	public void setOriginalLongitude(String originalLongitude) {
		this.originalLongitude = originalLongitude;
	}

	@Override
	public String toString() {
		return "SimplePlacemarkObject [coord=" + coord + ", nextPlacemarkId="
				+ nextPlacemarkId + ", placemarkId=" + placemarkId
				+ ", points=" + points + ", region=" + region + ", shape="
				+ shape + ", samplePointOutlined=" + samplePointOutlined
				+ ", elevation=" + elevation + ", slope=" + slope + ", aspect="
				+ aspect + ", extraInfo=" + Arrays.toString(extraInfo)
				+ ", valuesByColumn=" + valuesByColumn + ", extraColumns="
				+ Arrays.toString(extraColumns) + ", idColumns="
				+ Arrays.toString(idColumns) + ", originalLatitude="
				+ originalLatitude + ", originalLongitude=" + originalLongitude
				+ ", kmlPolygon=" + kmlPolygon + "]";
	}

	public String getVisiblePlacemarkId() {
		return visiblePlacemarkId;
	}

	public void setVisiblePlacemarkId(String visiblePlacemarkId) {
		this.visiblePlacemarkId = visiblePlacemarkId;
	}


}
