package org.openforis.collect.earth.sampler.model;

public enum AspectCode {
	N("North",1), NE("North-East",2), E("East",3), SE("South-East",4), S("South",5), SW("South-West",6), W("West",7), NW("North-West",8), NA("NA",9);
	private String label;
	private int id;

	public int getId() {
		return id;
	}

	public void setId(int id) {
		this.id = id;
	}

	private AspectCode(String label, int id) {
		this.label = label;
		this.id = id;
	}

	public String getLabel() {
		return label;
	}

	@Override
	public String toString() {
		return label;
	}
	
	public static AspectCode getHumanReadableAspect(Double aspect) {
		double aspectProc = aspect + 22.5;
		if (aspectProc >= 360d) {
			aspectProc = aspectProc - 360;
		}
		final int modulo = (int) Math.floor(aspectProc / 45d);
		return AspectCode.values()[modulo];
	}

}
