package org.openforis.collect.earth.app.server;

import java.util.Map;

import org.openforis.collect.earth.core.model.PlacemarkLoadResult;

/**
 * Methods for setting/getting the data for the placemarks.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public interface DataAccessor {

	/**
	 * Returns the data collected for a placemark.
	 * @param placemarkId The placemark unique ID.
	 * @return A map of data name-value pairs using collects naming protocol.
	 */
	public Map<String, String> getData(String placemarkId);
	
	public PlacemarkLoadResult loadDataExpanded(String placemarkId);

	public boolean saveData(Map<String, String> collectedData);
	
	public PlacemarkLoadResult saveDataExpanded(Map<String, String> collectedData);
}
