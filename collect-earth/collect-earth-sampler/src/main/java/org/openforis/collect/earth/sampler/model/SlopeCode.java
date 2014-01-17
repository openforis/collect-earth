package org.openforis.collect.earth.sampler.model;

/**
 * Slope codes by range associated to a slope in degrees ( 0-5 degrees flat, 6-15 slight, 15-30 steep and so on) 
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public enum SlopeCode {
	FLAT("Flat (0-5)", 1, 0, 5), SLIGHT("6-15", 2, 6, 15), STEEP("16-30", 3, 16, 30), VERY_STEEP("31-45", 4, 31, 45), EXTREME("46-60", 5, 46, 60), FALL(
			"61-90", 6, 61, 90), NA("NA", 7, -1, -1);

	
	/**
	 * Utility method to calculate the slope-code for a given slope in degrees.
	 * @param slope The slope in degrees
	 * @return The slope code for the given slope in degrees.
	 */
	public static SlopeCode getSlopeCode(int slope) {

		final SlopeCode[] slopeCodes = SlopeCode.values();
		for (final SlopeCode slopeCode : slopeCodes) {
			if (slope >= slopeCode.getStartSlope() && slope <= slopeCode.getEndSlope()) {
				return slopeCode;
			}
		}
		return null;

	}

	private String label;

	private int id;
	
	/**
	 * The start and end of the range used to classify a slope code.  
	 */
	private int startSlope, endSlope;
	

	private SlopeCode(String label, int id, int startSlope, int endSlope) {
		this.label = label;
		this.id = id;
		this.startSlope = startSlope;
		this.endSlope = endSlope;
	}

	public int getEndSlope() {
		return endSlope;
	}

	public int getId() {
		return id;
	}

	public String getLabel() {
		return label;
	}

	public int getStartSlope() {
		return startSlope;
	}

	@Override
	public String toString() {
		return label;
	}

}
