package org.openforis.collect.earth.planet;

import java.util.Date;

public class PlanetRequestParameters {
	public Date start;
	public Date end;
	public double[][][] coords;
	public String[] itemTypes;

	public PlanetRequestParameters(Date start, Date end, double[][][] coords, String[] itemTypes) {
		this.start = start;
		this.end = end;
		this.coords = coords;
		this.itemTypes = itemTypes;
	}
}