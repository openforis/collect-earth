package org.openforis.collect.earth.app.model;

import org.openforis.collect.earth.app.view.Messages;

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
	N(Messages.getString("AspectCode.0"), 1), NE(Messages.getString("AspectCode.1"), 2), E(Messages.getString("AspectCode.2"), 3), SE(Messages.getString("AspectCode.3"), 4), S(Messages.getString("AspectCode.4"), 5), SW(Messages.getString("AspectCode.5"), 6), W(Messages.getString("AspectCode.6"), 7), NW(Messages.getString("AspectCode.7"), 8), NA( "NA", 9); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$ //$NON-NLS-4$ //$NON-NLS-5$ //$NON-NLS-6$ //$NON-NLS-7$ //$NON-NLS-8$ //$NON-NLS-9$
	/**
	 * Utility method to get the aspect code ( N, N-E ... ) from the aspect in degrees
	 * 
	 * @param aspect
	 *            The aspect in degrees
	 * @return The aspect code corresponding to the aspect in degrees.
	 */
	public static AspectCode getAspectCode(Double aspect) {
		double aspectProc = aspect + 22.5d; // North starts at -22.5, so add 22.5 to normalize so north becomes 0-45 , north east 45-90 and so on..
		if (aspectProc >= 360d) {
			aspectProc = aspectProc - 360d;
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
