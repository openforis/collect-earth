package org.openforis.collect.earth.sampler.model;

public enum SlopeCode {
	FLAT("Flat (0-5)", 1, 0, 5), SLIGHT("6-15", 2, 6, 15), STRONG("16-30", 3, 16, 30), VERY_STRONG("31-45", 4, 31, 45), EXTREME("46-60", 5, 46, 60), MOUNTAIN(
			"61-90", 6, 61, 90), NA("NA",7,-1,-1);

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

	private int id, startSlope, endSlope;

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
