package org.openforis.collect.earth.planet;

public class FilterConfig {
	DatePlanet gte; // DateRangeFiter gte;
	DatePlanet lt;
	String type; // for geojson
	double[][][] coordinates;
	
	public FilterConfig(DatePlanet gte, DatePlanet lt) {
		super();
		this.gte = gte;
		this.lt = lt;
	}
	
	public FilterConfig(String type, double[][][] coordinates) {
		super();
		this.type = type;
		this.coordinates = coordinates;
	}

	public DatePlanet getGte() {
		return gte;
	}
	public void setGte(DatePlanet gte) {
		this.gte = gte;
	}
	public DatePlanet getLt() {
		return lt;
	}
	public void setLt(DatePlanet lt) {
		this.lt = lt;
	}

	public double[][][] getCoordinates() {
		return coordinates;
	}

	public void setCoordinates(double[][][] coordinates) {
		this.coordinates = coordinates;
	}
	
	
	
}
