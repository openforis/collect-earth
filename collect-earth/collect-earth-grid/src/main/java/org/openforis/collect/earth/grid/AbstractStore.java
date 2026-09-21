package org.openforis.collect.earth.grid;

public abstract class AbstractStore {
	
	private Integer[] distances = new Integer[] { 1, 2 , 3 , 4, 5, 6, 8, 9, 10, 12, 15, 16, 20, 25, 30, 50, 100 };

	protected Integer[] getDistances() {
		return distances;
	}

	protected void setDistances(Integer[] distances) {
		this.distances = distances;
	}

	/**
	 * The subgrids that a plot belongs to, one bit per entry of {@link #getDistances()}.
	 *
	 * The bit used to be shifted by the distance itself, and an int only has 32 of them : 1 << 50 is 1 << 18 and 1 << 100 is
	 * 1 << 4, so the grid of 100 was written into the bit of the grid of 4 and the grids of 50 and 100 could not be told
	 * apart from the others. The position in the list is always inside the 32 bits.
	 *
	 * @param row The row of the plot
	 * @param column The column of the plot
	 * @return The flags to store for this plot
	 */
	protected int getGridFlags(int row, int column) {
		int gridFlags = 0;
		for (int i = 0; i < getDistances().length; i++) {
			final int distance = getDistances()[i];
			if (column % distance + row % distance == 0) {
				gridFlags = gridFlags | (1 << i);
			}
		}
		return gridFlags;
	}

	public abstract void initializeStore(int distanceBetweenPlots) throws Exception;

	public abstract void savePlot(Double latitude, Double longitude, Integer row, Integer column);

	public abstract void  closeStore();
	

}
