package org.openforis.collect.earth.grid;

public abstract class AbstractStore {
	
	private Integer[] distances = new Integer[] { 1, 2 , 3 , 4, 5, 6, 8, 9, 10, 12, 15, 16, 20, 25, 30, 50, 100 };

	protected Integer[] getDistances() {
		return distances;
	}

	protected void setDistances(Integer[] distances) {
		this.distances = distances;
	}

	public abstract void initializeStore(int distanceBetweenPlots) throws Exception;

	public abstract void savePlot(Double latitude, Double longitude, Integer row, Integer column);

	public abstract void  closeStore();
	

}
