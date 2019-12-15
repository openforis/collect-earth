package org.openforis.collect.earth.app.view;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
class ComboBoxItem {

	private Integer numberOfPoints;
	private String label;

	protected ComboBoxItem(int numberOfPoints, String label) {
		super();
		this.numberOfPoints = numberOfPoints;
		this.label = label;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		ComboBoxItem other = (ComboBoxItem) obj;
		if (numberOfPoints == null) {
			if (other.numberOfPoints != null)
				return false;
		} else if (!numberOfPoints.equals(other.numberOfPoints))
			return false;
		return true;
	}

	public int getNumberOfPoints() {
		return numberOfPoints;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + ((label == null) ? 0 : label.hashCode());
		result = prime * result + ((numberOfPoints == null) ? 0 : numberOfPoints.hashCode());
		return result;
	}

	@Override
	public String toString() {
		return label;
	}

}