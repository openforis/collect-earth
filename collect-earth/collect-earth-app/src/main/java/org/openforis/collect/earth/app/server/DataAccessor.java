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
	
	public Map<String, String> getData(String[] multipleKeyAttributes);
		
	public PlacemarkLoadResult loadDataExpanded(String[] multipleKeyAttributes);

	public boolean saveData(Map<String, String> collectedData);
		
	public PlacemarkLoadResult updateData(String[] multipleKeyAttributes, 
			Map<String, String> values, boolean partialUpdate);

}
