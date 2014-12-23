package org.openforis.collect.earth.app.server;

import java.util.Map;

/**
 * Methods for setting/getting the data for the placemarks.
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public interface DataAccessor {

	/**
	 * Returns the data collected for a placemark.
	 * @param placemarkId The placemark parameters received from Collect Earth interface.
	 * @return A map of data name-value pairs using collects naming protocol.
	 */
	public Map<String, String> getData(Map<String, String> parameters);

	public boolean saveData(Map<String, String> collectedData);
}
