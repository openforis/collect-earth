package org.openforis.collect.earth.app.model;

/**
 * Enumeration of the aspects that Collect Earth can use to classify the plots.
 * Each aspect has an ID attach to it and represents a 45 dregree range ( -22.5 to 22.5 for North, 22.5 to 67.5 to North East, 66.5 to 112.5 for East
 * and so on)
 * The enumeration also has an static method to calculate the
 * 
 * @author Alfonso Sanchez-Paus Diaz
 * 
 */
public enum AspectCode {
	N("North", 1), NE("North-East", 2), E("East", 3), SE("South-East", 4), S("South", 5), SW("South-West", 6), W("West", 7), NW("North-West", 8), NA( "NA", 9);
	/**
	 * Utility method to get the aspect code ( N, N-E ... ) from the aspect in degrees
	 * 
	 * @param aspect
	 *            The aspect in degrees
	 * @return The aspect code corresponding to the aspect in degrees.
	 */
	public static AspectCode getAspectCode(Double aspect) {
		double aspectProc = aspect + 22.5; // North starts at -22.5, so add 22.5 to normalize so north becomes 0-45 , north east 45-90 and so on..
		if (aspectProc >= 360d) {
			aspectProc = aspectProc - 360;
		}
		final int modulo = (int) Math.floor(aspectProc / 45d);
		return AspectCode.values()[modulo];
	}

	private String label;

	private int id;

	private AspectCode(String label, int id) {
		this.label = label;
		this.id = id;
	}

	public int getId() {
		return id;
	}

	public String getLabel() {
		return label;
	}

	public void setId(int id) {
		this.id = id;
	}

	@Override
	public String toString() {
		return label;
	}

}
